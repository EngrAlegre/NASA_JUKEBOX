#!/usr/bin/env bash
# DNS availability sniff for domain candidates.
#   bash tools/checks/domains.sh
# NXDOMAIN is a good signal that a name is unregistered; it is not a registrar
# check, and a parked domain resolves without being "in use".
for d in \
  earthjukebox.com earthjukebox.space earthjukebox.org \
  jukebox.space theearthjukebox.com \
  earthin.space earthaudio.fm earthrecord.space \
  sonify.space sonifyaudio.com \
  hearplanet.space listentotheearth.com \
  planetplayback.com orbitradio.fm \
  brightearth.audio earthloop.fm terra.fm
do
  out=$(nslookup "$d" 2>&1)
  if echo "$out" | grep -qi "Non-existent\|NXDOMAIN\|can't find"; then
    printf "%-26s free?\n" "$d"
  elif echo "$out" | grep -qi "Address:"; then
    printf "%-26s TAKEN\n" "$d"
  else
    printf "%-26s unknown\n" "$d"
  fi
done
