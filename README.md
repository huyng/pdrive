# pdrive

pdrive is a browser-based document and file manager based on python3 and vue.js.

![in mov](https://cloud.githubusercontent.com/assets/121183/21594148/018e5c90-d0d4-11e6-9464-74737d860b0b.gif)



### installation

```
pip3 install pdrive
```

### getting started

You can run pdrive by calling the `pdrive` command within a directory you want explore. Once running, you can visit the web interface at `http://127.0.0.1:9999`.

If you're running this on a remote server, you can use port forwarding to access the web interface over an ssh connection:

```
ssh -N -L 9999:localhost:9999 your@host.com
```

PLEASE NOTE: pdrive will have all the same permissions to modify your file system as the user running the program.

### usage

```
usage: pdrive [-h] [-H HOST] [-p PORT]

optional arguments:
  -h, --help            show this help message and exit
  -H HOST, --host HOST
  -p PORT, --port PORT
```
