#!/bin/bash
nohup /analytics.sh > /dev/null 2>&1 &
/etc/init.d/ssh start
