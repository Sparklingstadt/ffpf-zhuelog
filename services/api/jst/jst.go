// Package jst holds Japan Standard Time, the zone every calendar day in the
// app (study log, streaks, AI usage months, the demo fixture) is counted in.
package jst

import "time"

// Location is Japan Standard Time, fixed at UTC+9 (Japan has no daylight
// saving).
var Location = time.FixedZone("JST", 9*3600)
