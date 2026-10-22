#!/bin/bash
cd "$(dirname "$0")" || exit 1
bash ./start.sh
result=$?
printf '\n按回车关闭此窗口…'
read -r _
exit "$result"
