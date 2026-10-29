# pdrive

pdrive is a browser-based file manager. If you need a quick way of browsing files on a remote server, this is the tool for you.

Long operations - uploading a file, compressing a folder, unpacking an archive - run as jobs in the server rather than in the request that started them, so the interface stays usable while they work and reports their progress instead of freezing on a spinner.


![pdrive](https://user-images.githubusercontent.com/121183/87987433-7e86fb00-ca93-11ea-9236-14823d0650c2.gif)


### Installation

```
# If you want to install with pip
pip install pdrive

# Or if you want to install with uv
uv tool install pdrive

# Or you can even run the tool without installing using uv's uvx:
uvx pdrive
```

### Usage

You can start a server for browsing or modifying a given directory with the following command

```
cd /path/to/my/directory
pdrive
```

### Getting started

You can run pdrive by calling the `python -m pdrive` command within a directory you want to explore. Once running, you can visit the web interface at `http://127.0.0.1:9999`.

If you're running this on a remote server, you can use ssh port forwarding to access the web interface over an ssh connection:

```
ssh -N -L 9999:localhost:9999 your@host.com
```

**SECURITY NOTE:** pdrive will have all the same permissions to modify your file system as the user who started the program.

### Documentation

```
usage: pdrive [-h] [-H HOST] [-p PORT]

optional arguments:
  -h, --help            show this help message and exit
  -H HOST, --host HOST
  -p PORT, --port PORT
```
