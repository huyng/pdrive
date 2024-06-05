# pdrive

pdrive is a browser-based document and file manager based on Python 3 and vue.js. If you need a quick way of browsing files on a remote server, this is the tool for you.

You can use it as a pretty alternative to `python -m http.server` or as a simple interface into a remote network-attached-storage drive.

It's designed to combine the excellent usability of Google Drive with the benefits of having control over your own data.

![pdrive](https://user-images.githubusercontent.com/121183/87987433-7e86fb00-ca93-11ea-9236-14823d0650c2.gif)


### installation

```
pip install pdrive
```

### Usage

You can start a server for browsing or modifying a given directory with the following command

```
cd /path/to/my/directory
python -m pdrive
```

### getting started

You can run pdrive by calling the `python -m pdrive` command within a directory you want to explore. Once running, you can visit the web interface at `http://127.0.0.1:9999`.

If you're running this on a remote server, you can use ssh port forwarding to access the web interface over an ssh connection:

```
ssh -N -L 9999:localhost:9999 your@host.com
```

**SECURITY NOTE:** pdrive will have all the same permissions to modify your file system as the user who started the program.

### Documentation

```
usage: python -m pdrive [-h] [-H HOST] [-p PORT]

optional arguments:
  -h, --help            show this help message and exit
  -H HOST, --host HOST
  -p PORT, --port PORT
```
