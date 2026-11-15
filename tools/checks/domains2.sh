#!/usr/bin/env bash
# Second-round name candidates. Differentiated from the existing earthjukebox.com.
for d in \
  planetjukebox.com planetjukebox.space \
  fivesides.space fivesides.com \
  terrasonic.com terrasound.com \
  pixeljukebox.com pixelscore.com \
  mapmusic.space readtheearth.com \
  earthreadout.com datasings.com \
  jukebox.audio soundofearth.space \
  earthinfive.com fiveearth.com
do
  out=$(nslookup "$d" 2>&1)
  if echo "$out" | grep -qi "Non-existent\|NXDOMAIN\|can't find"; then
    printf "%-24s free?\n" "$d"
  elif echo "$out" | grep -qi "Address:"; then
    printf "%-24s TAKEN\n" "$d"
  else
    printf "%-24s unknown\n" "$d"
  fi
done
