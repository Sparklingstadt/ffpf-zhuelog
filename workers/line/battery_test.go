package main

import "testing"

func TestBatteryParsing(t *testing.T) {
	t.Parallel()
	r := parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=123) 42%; discharging; 2:03 remaining present: true")
	if r["available"] != true || r["percent"] != 42 || r["remainingMinutes"] != 123 || r["state"] != "discharging" || r["powerSource"] != "battery" {
		t.Fatal(r)
	}
	for _, text := range []string{"garbage", "-InternalBattery-0 101%; charging;", "-InternalBattery-0 unknown;"} {
		if parseBattery(text)["reason"] != "read-failed" {
			t.Fatal("invalid report accepted")
		}
	}
	if parseBattery("Now drawing from 'AC Power'")["reason"] != "no-battery" {
		t.Fatal("no battery")
	}
	r = parseBattery("Now drawing from 'AC Power'\n-InternalBattery-0 100%; not charging; (no estimate)")
	if r["state"] != "not-charging" || r["remainingMinutes"] != nil {
		t.Fatal(r)
	}
}
