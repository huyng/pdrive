#!/usr/bin/env python
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

from setuptools import setup

setup(name='pdrive',
      version='0.7.0',
      description='File manager',
      author='Huy Nguyen',
      author_email='121183+huyng@users.noreply.github.com',
      packages=['pdrive', "pdrive.frontend", "pdrive.backend"],
      package_data={
          'pdrive.frontend': ['index.html', 'dist/*']
      },
      entry_points={
          "console_scripts": [
              "pdrive = pdrive.backend.web:main"
          ]
      },
      install_requires=["Flask"],
      zip_safe=False,
      url="https://github.com/huyng/pdrive")

# to distribute run:
# python setup.py register sdist upload
# python -m twine  upload dist
