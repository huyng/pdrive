# pdrive

pdrive is a browser-based document and file manager based on Python 3 and vue.js. If you need a quick way of browsing files on a remote server, this is the tool for you.

You can use it as a pretty alternative to `python -m http.server` or as a simple interface into a remote network-attached-storage drive.

It's designed to combine the excellent usability of Google Drive with the benefits of having control over your own data.

![pdrive](https://user-images.githubusercontent.com/121183/87984756-50072100-ca8f-11ea-853d-a3fb976156bc.gif)


### installation

```
pip install pdrive
```

### getting started

You can run pdrive by calling the `pdrive` command within a directory you want to explore. Once running, you can visit the web interface at `http://127.0.0.1:9999`.

If you're running this on a remote server, you can use ssh port forwarding to access the web interface over an ssh connection:

```
ssh -N -L 9999:localhost:9999 your@host.com
```

**SECURITY NOTE:** pdrive will have all the same permissions to modify your file system as the user who started the program.

### usage

```
usage: pdrive [-h] [-H HOST] [-p PORT]

optional arguments:
  -h, --help            show this help message and exit
  -H HOST, --host HOST
  -p PORT, --port PORT
```
