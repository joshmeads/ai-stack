#!/bin/sh
set -eu

catalog=$1/references/primitive-icons.md
gallery=$1/assets/icons.html

drop_section() {
  awk -v name="$1" '
    skipping && /^##+ / {
      print "skill patch: section " name " has no unlicensed Source line" > "/dev/stderr"
      bad = 1
      exit 1
    }
    skipping && /^Source: Direct fetch \/ / && /verify license before use/ {
      skipping = 0
      dropped = 1
      eat_blank = 1
      next
    }
    skipping { next }
    $0 == "### " name { skipping = 1; next }
    eat_blank { eat_blank = 0; if ($0 == "") next }
    { print }
    END {
      if (bad) exit 1
      if (skipping || !dropped) {
        print "skill patch: unlicensed section " name " not found in " FILENAME > "/dev/stderr"
        exit 1
      }
    }
  ' "$catalog" > "$catalog.patched"
  mv "$catalog.patched" "$catalog"
}

drop_cell() {
  awk -v name="$1" '
    index($0, "<div class=\"cell\">") == 1 && index($0, "<div class=\"name\">" name "</div></div>") > 0 {
      dropped++
      next
    }
    { print }
    END {
      if (dropped != 1) {
        print "skill patch: expected one " name " cell in " FILENAME ", found " dropped + 0 > "/dev/stderr"
        exit 1
      }
    }
  ' "$gallery" > "$gallery.patched"
  mv "$gallery.patched" "$gallery"
}

drop_section hop
drop_section pentaho
drop_section dagster
drop_section sas
drop_section stata

drop_cell hop
drop_cell pentaho
drop_cell dagster
drop_cell sas
drop_cell stata

if grep -qF 'verify license before use' "$catalog"; then
  echo "skill patch: an unlicensed icon remains in $catalog" >&2
  exit 1
fi
