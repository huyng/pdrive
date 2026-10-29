# pdrive - a web based document browser
# Copyright (C) 2017 Huy Nguyen
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""Jobs: work that outlives the request that started it.

Compressing two thousand files takes longer than a page should sit on a
spinner, and the answer - the archive's node, or the list of items that were
already there - is worth nothing to a request that has already been answered and
forgotten. So the work gets an id, runs in a thread of its own, and reports to
whoever is watching `job:<id>` instead.

Blocking filesystem work goes through `asyncio.to_thread`: a zip would otherwise
hold the event loop for the length of the archive and every socket and every
other request would wait behind it. The thread reports progress through
`loop.call_soon_threadsafe`, which is the only thing here that is not plain
function calls.

A finished job is kept for `RETAIN_SECONDS` so that a page which asked late, or
reconnected after a restart of its network, still finds out how it ended. After
that it is gone: jobs are this process's memory, and the disk is not their
ledger.
"""

import asyncio
import dataclasses
import re
import secrets
import time
import traceback

from . import ws

# how long a finished job stays in the listing and on its topic
RETAIN_SECONDS = 300

# progress is published when it moved this much. A job reports per entry, which
# for a large archive means thousands of calls; sending a frame for each would
# cost more than the compression.
PROGRESS_STEP = 0.02


@dataclasses.dataclass
class Job:
    id: str
    kind: str
    label: str
    state: str = "running"
    progress: float = 0.0
    result: dict = None
    error: str = None
    # the status the command answered with: 409 is not a failure of the job but
    # the "these items exist" question the caller has to ask the user
    status: int = 200
    created: float = dataclasses.field(default_factory=time.time)
    # the loop that owns this job: the worker thread publishes through it
    loop: object = dataclasses.field(default=None, repr=False, compare=False)

    def as_dict(self):
        return {
            "id": self.id,
            "kind": self.kind,
            "label": self.label,
            "state": self.state,
            "progress": round(self.progress, 3),
            "result": self.result,
            "error": self.error,
            "status": self.status,
            "created": self.created,
        }


# a job id is a topic name and a dictionary key, so a client may propose one
# (`j_1a2b3c4d`) but only in this shape
ID_PATTERN = re.compile(r"^j_[0-9a-z]{4,32}$")

_jobs = {}
_tasks = set()


def new_id():
    return "j_" + secrets.token_hex(4)


def looks_like_id(value):
    return isinstance(value, str) and ID_PATTERN.match(value) is not None


def topic(job_id):
    return "job:" + job_id


def get(job_id):
    return _jobs.get(job_id)


def listing():
    return [job.as_dict() for job in _jobs.values()]


def _publish(job):
    ws.hub.publish(topic(job.id), job.as_dict())


def begin(kind, label, job_id=None):
    """Create a running job and announce it.

    `job_id` is honoured when it is free: an upload knows the id of its own job
    before the bytes start arriving, which is what lets the page watch the
    transfer instead of the result of it.
    """
    if not looks_like_id(job_id) or job_id in _jobs:
        job_id = new_id()
    job = Job(id=job_id, kind=kind, label=label,
              loop=asyncio.get_running_loop())
    _jobs[job.id] = job
    _publish(job)
    return job


def relabel(job, label):
    """Say what the job turned out to be, once the request showed it."""
    job.label = label


def advance(job, progress):
    """Report progress. Called from the worker thread, so: thread safe."""
    progress = max(0.0, min(float(progress), 1.0))
    if progress - job.progress < PROGRESS_STEP and progress < 1.0:
        return
    job.progress = progress
    # published from the loop, and the loop reads the latest state when it gets
    # there: a burst of reports collapses into the newest one
    job.loop.call_soon_threadsafe(_publish, job)


def _settle(job, state, result=None, error=None, status=200):
    job.state = state
    job.result = result
    job.error = error
    job.status = status
    job.progress = 1.0
    _publish(job)
    job.loop.call_later(RETAIN_SECONDS, _jobs.pop, job.id, None)


def finish(job, result, status=200):
    _settle(job, "done" if 200 <= status < 300 else "error", result=result,
            status=status)


def fail(job, error, status=500):
    _settle(job, "error", error=error, status=status)


async def _run(job, work):
    try:
        data, status = await asyncio.to_thread(work, lambda p: advance(job, p))
    except Exception as error:
        # a job that raised is still a job that ended: the page is told, and the
        # traceback goes where the other failures go
        traceback.print_exc()
        fail(job, "%s: %s" % (type(error).__name__, error))
    else:
        finish(job, data, status)


def start(job, work):
    """Run `work(progress) -> (data, status)` in a thread and settle the job."""
    task = asyncio.create_task(_run(job, work))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


def snapshot(topic_name):
    """The state of a job, for a client that subscribes after it started."""
    if not topic_name.startswith("job:"):
        return None
    job = _jobs.get(topic_name[len("job:"):])
    return job.as_dict() if job is not None else None


ws.provide_snapshot(snapshot)
