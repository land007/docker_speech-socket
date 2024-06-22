#!/bin/bash
DIR=$1
if [ -n "$(ls -A ${DIR})" ]; then
    echo "${DIR} is not empty"
else
    echo "${DIR} is empty"
    echo "cp -R ${DIR}_ ${DIR}"
    cp -R ${DIR}_/* ${DIR}
fi
chmod -R 777 ${DIR}
