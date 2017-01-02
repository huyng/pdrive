#!/usr/bin/env python
from setuptools import setup

setup(name='pdrive',
      version='0.5',
      description='File manager',
      author='Huy Nguyen',
      author_email='huy@huyng.com',
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
# python setup.py register sdist  upload
