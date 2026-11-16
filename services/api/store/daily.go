package store

import (
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/jst"
)

// jstDay is the SQL for the JST calendar date of col, a TIMESTAMP column that
// holds UTC (the columns are TIMESTAMP(3) without time zone, so the 9 hours
// are added rather than using AT TIME ZONE).
func jstDay(col string) string {
	return "(" + col + " + interval '9 hours')::date"
}

// LogDate is a calendar date in JST.
type LogDate struct {
	Year, Month, Day int
}

// dayRange returns [start, end) of the JST date d as UTC DB times.
func (d LogDate) dayRange() (time.Time, time.Time) {
	start := time.Date(d.Year, time.Month(d.Month), d.Day, 0, 0, 0, 0, jst.Location)
	end := time.Date(d.Year, time.Month(d.Month), d.Day+1, 0, 0, 0, 0, jst.Location)
	return dbTime(start), dbTime(end)
}
