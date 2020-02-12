import time
import logging
import sys

logger = logging.getLogger()
logger.setLevel(logging.DEBUG)

handler = logging.StreamHandler(sys.stdout)
handler.setLevel(logging.DEBUG)
formatter = logging.Formatter('%(asctime)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

count = 0

def foo():
  global count  
  count = count + 1
  logger.info("node 2 - count {count}".format(count=count))

while True:
  foo()
  time.sleep(1)
