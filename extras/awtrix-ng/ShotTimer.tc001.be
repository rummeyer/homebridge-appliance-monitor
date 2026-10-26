# @name ShotTimer
# @desc Coffee machine from Appliance Monitor: heating up, running time, time until it switches off, and a shot timer
# @author Oliver Rummeyer
# @version 5.0
# @config base text "Appliance topic" default="appliance-monitor/Kaffeemaschine"
# @config shot text "Shot topic" default="shot-timer"
# @config pump text "Pump phase" default="Pumpe"
# @config after number "Pump on after" default=1 min=0 max=60 unit=s
# @config heat text "Heating phase" default="Aufheizen"
# @config rinse text "Rinse phase" default="Spülen"
# @config lead number "Plug delay" default=5 min=0 max=30 unit=s
# @config temp text "Temperature topic" default="deconz/Kaffeemaschine/temperature"
# @config ready number "Preheated from" default=38 min=0 max=100 unit=°C
# @config heatas select "Heating up as" default=bar options=bar,percent
# @config cold number "Cold after" default=45 min=0 max=1440 unit=min
# @config coldpre number "Cold preheat" default=30 min=0 max=120 unit=min
# @config hold number "Show result for" default=20 min=1 max=600 unit=s
# @config pin bool "Stay on screen while on" default=false
# @config done color "Result" default=#30D158
# @config hot color "Heating" default=#FF8C00
# @config red color "Heated" default=#FF3B30
class ShotTimer
var start_topic, end_topic, state_topic, since_topic, heat_topic, idle_topic, over_topic
var rinse_topic, rinsed
var pump_topic, until_topic
var by_phase, on_after
var temp_topic, ready, temp
var temp0
var temp0_s, temp_s
var heat_done
var pumped
var warm
var hist
var cold
var cold_s, coldpre_s
var was_heated
var lead_ms, hold_ms, pin
var cup
var x0
var done, hot, red, white, grey, warn
var shot         # "idle", "run" or "done"
var t0
var stopped
var final_s
var running
var known
var since_s
var since_ms
var heating
var idle_at, over_at
var idle_len
var built
var shown
var line1, line2
var bar
var as_bar
var timer_id
var wait_id
var visible
def init()
var base = store.get("base")
var shot = store.get("shot")
self.start_topic = shot + "/start"
self.end_topic = shot + "/end"
self.pump_topic = base + "/phase/" + store.get("pump")
self.until_topic = self.pump_topic + "/until"
self.by_phase = shot == ""
self.on_after = store.get("after")
self.state_topic = base + "/state"
self.since_topic = base + "/since"
self.heat_topic = base + "/phase/" + store.get("heat")
self.idle_topic = base + "/idle/at"
self.over_topic = base + "/overtime/at"
self.rinse_topic = base + "/phase/" + store.get("rinse")
self.rinsed = false
self.temp_topic = store.get("temp")
self.ready = store.get("ready")
self.temp = nil
self.temp0 = nil
self.temp0_s = 0
self.temp_s = 0
self.heat_done = false
self.pumped = false
self.warm = false
self.hist = []
self.cold = true
self.was_heated = false
self.cold_s = int(store.get("cold") * 60)
self.coldpre_s = int(store.get("coldpre") * 60)
self.lead_ms = int(store.get("lead") * 1000)
self.hold_ms = int(store.get("hold") * 1000)
self.pin = store.get("pin")
self.as_bar = store.get("heatas") != "percent"
self.bar = nil
self.x0 = height() > 8 ? 17 : 9
self.cup = bytes("0003FCFAFC0103A4726C0203A4726C0303A4726C0403A4726C0503FCFAFC0603FCFAFC0703FCFAFC0004FCFAFC0104FCFAFC0204FCFAFC0304FCFAFC0404FCFAFC0504FCFAFC0704FCFAFC0005FCFAFC0105FCFAFC0205FCFAFC0305FCFAFC0405FCFAFC0505FCFAFC0605FCFAFC0705FCFAFC0106FCFAFC0206FCFAFC0306FCFAFC0406FCFAFC0207FCFAFC0307FCFAFC")
self.done = store.get("done")
self.hot = store.get("hot")
self.red = store.get("red")
self.white = settings.get("textColor")
if self.white == nil
self.white = 0xFFFFFF
end
self.grey = 0x808080
self.warn = 0xFFD60A
self.shot = "idle"
self.t0 = 0
self.stopped = nil
self.final_s = 0
self.running = false
self.known = false
self.since_s = 0
self.since_ms = 0
self.heating = false
self.idle_at = 0
self.idle_len = 0
self.over_at = 0
self.built = -1
self.shown = -1
self.line1 = nil
self.line2 = nil
self.timer_id = nil
self.wait_id = nil
self.visible = false
end
def setup()
if !self.by_phase
mqtt.subscribe(self.start_topic, / t, p -> self.started(num(p, 0)))
mqtt.subscribe(self.end_topic, / t, p -> self.ended(num(p, 0)))
end
mqtt.subscribe(store.get("base") + "/#", / t, p -> self.machine(t, p))
if self.temp_topic != ""
mqtt.subscribe(self.temp_topic, / t, p -> self.temperature(num(p)))
end
end
def temperature(v)
if v != nil
self.temp = v
self.temp_s = epoch_ms() / 1000
if self.running && self.temp0 == nil
self.temp0 = v
self.temp0_s = self.temp_s
self.keep()
end
if self.running && !self.warm
self.hist.push([self.temp_s, v])
if size(self.hist) > 120
self.hist.remove(0)
end
end
if self.running && v >= self.ready && !self.warm
self.warm = true
self.keep()
end
self.built = -1
end
end
def thermo()
if self.temp == nil
return false
end
if !self.running || self.temp0 == nil || self.temp != self.temp0
return true
end
var on = self.since_s > 0 ? self.since_s : self.temp0_s
return epoch_ms() / 1000 - on < 900
end
def heated()
if self.warm
return true
end
if self.thermo()
return self.temp >= self.ready
end
return self.cold ? self.since_s > 0 && epoch_ms() / 1000 - self.since_s >= self.coldpre_s : self.heat_done
end
def warming()
return self.running && !self.pumped && !(self.shot == "done" && !self.rinsed) &&
!self.heated() && (self.thermo() || self.heating || self.cold)
end
def machine(t, p)
if t == self.until_topic
if self.shot == "run"
var v = num(p, 0)
self.stopped = v > 0 ? max(self.t0, now_ms() - (epoch_ms() / 1000 - v) * 1000) : nil
end
elif t == self.state_topic
var was = self.running
self.running = p == "running"
if self.running != was
var old = self.known && now_ms() - self.since_ms > 2000
self.cold = !(old && self.since_s > 0 && epoch_ms() / 1000 - self.since_s < self.cold_s)
if old
self.since_s = 0
end
self.hist = []
self.was_heated = false
self.heat_done = false
self.pumped = false
self.temp0 = self.running ? self.temp : nil
self.warm = self.running && self.temp != nil && self.temp >= self.ready
self.idle_len = 0
self.temp0_s = epoch_ms() / 1000
if self.running && self.pin && self.since_s > 0
self.come()
elif !self.running && self.shot == "idle"
self.leave()
end
end
self.recall()
self.known = true
elif t == self.since_topic
self.since_s = num(p, 0)
self.since_ms = now_ms()
self.recall()
self.keep()
if self.running && self.pin && self.since_s > 0
self.come()
end
elif t == self.heat_topic
var on = p == "ON"
if self.heating && !on && self.running && !self.heat_done
self.heat_done = true
self.keep()
end
self.heating = on
elif t == self.pump_topic && self.by_phase
if p == "ON" && self.shot != "run"
self.started(self.on_after)
elif p == "OFF" && self.shot == "run"
self.ended(((self.stopped != nil ? self.stopped : now_ms()) - self.t0) / 1000.0)
end
elif t == self.rinse_topic
if p == "ON" && self.shot != "idle"
self.rinsed = true
end
elif t == self.idle_topic
self.idle_at = num(p, 0)
var left = (self.idle_at - epoch_ms() / 1000 + 30) / 60 * 60
if left > self.idle_len
self.idle_len = left
end
elif t == self.over_topic
self.over_at = num(p, 0)
end
self.built = -1
end
def keep()
if self.running && self.since_s > 0
store.set("on", [self.since_s, self.temp0, self.temp0_s, self.cold, self.warm, self.heat_done, self.pumped])
end
end
def recall()
var k = store.get("on")
if self.running && self.since_s > 0 && k != nil && size(k) == 7 && k[0] == self.since_s
self.temp0 = k[1]
self.temp0_s = k[2]
self.cold = k[3]
self.warm = k[4] || self.warm
self.heat_done = k[5] || self.heat_done
self.pumped = k[6] || self.pumped
self.built = -1
end
end
def started(seconds)
timer.cancel(self.timer_id)
self.t0 = now_ms() - int(seconds * 1000) - self.lead_ms
self.stopped = nil
self.rinsed = false
self.shot = "run"
self.built = -1
rotation.show()
rotation.pause()
end
def ended(seconds)
if self.shot == "idle"
return
end
self.final_s = int(seconds + 0.5)
self.shot = "done"
self.built = -1
rotation.show()
rotation.pause()
timer.cancel(self.timer_id)
self.timer_id = timer.after(self.hold_ms, / -> self.finish())
end
def finish()
if !self.rinsed && !self.pumped
self.pumped = true
self.keep()
end
self.shot = "idle"
self.stopped = nil
self.timer_id = nil
self.built = -1
if !(self.pin && self.running)
self.leave()
end
end
def loop()
if self.shot == "run" && now_ms() - self.t0 > 90000
self.finish()
end
var h = self.running && self.heated()
if h && !self.was_heated
self.come()
end
self.was_heated = h
end
def come()
rotation.show()
if self.pin
rotation.pause()
end
end
def leave()
rotation.resume()
if self.visible
rotation.next()
end
end
def on_show()
self.visible = true
if !self.should_show()
timer.cancel(self.wait_id)
self.wait_id = timer.after(1000, / -> self.waited())
end
end
def waited()
self.wait_id = nil
if self.visible && !self.should_show()
self.leave()
end
end
def on_hide()
self.visible = false
end
def should_show()
return self.shot != "idle" || (self.running && self.since_s > 0)
end
def clock(s)
if s < 0
s = 0
end
var m = s / 60
if m >= 60
return str(m / 60) + ":" + (m % 60 < 10 ? "0" : "") + str(m % 60) + "h"
end
return str(m) + ":" + (s % 60 < 10 ? "0" : "") + str(s % 60)
end
def pair(label, value, color)
var both = [[label + " ", self.grey], [value, color]]
return text_width(both) <= width() - self.x0 ? both : [[value, color]]
end
def secs(s)
return s < 60 ? str(s) + "s" : self.clock(s)
end
def build(now)
var unix = epoch_ms() / 1000
var shot_s = -1
if self.shot == "run"
shot_s = ((self.stopped != nil ? self.stopped : now) - self.t0) / 1000
end
if unix == self.built && shot_s == self.shown
return
end
self.built = unix
self.shown = shot_s
self.bar = nil
if !self.running && self.shot == "idle"
self.line1 = nil
self.line2 = nil
return
end
var on_s = self.since_s > 0 ? unix - self.since_s : 0
var heating = self.warming()
if self.shot == "run"
self.line1 = self.pair("SHOT", self.secs(shot_s), self.white)
elif self.shot == "done"
self.line1 = self.pair(self.rinsed ? "RINSE" : "SHOT", self.secs(self.final_s), self.done)
elif heating
self.line1 = [["HEATING", self.hot]]
elif self.heated() && (unix / 3) % 2 == 1
self.line1 = [["HEATED", self.red]]
else
self.line1 = self.pair("ON", self.clock(on_s), self.white)
end
if heating
if self.thermo() && self.temp0 != nil && self.ready > self.temp0
var pct = int((self.temp - self.temp0) * 100 / (self.ready - self.temp0))
pct = pct < 0 ? 0 : (pct > 100 ? 100 : pct)
if self.as_bar
self.bar = pct
self.line2 = []
else
self.line2 = [[str(pct) + "%", self.white]]
end
var from_v = self.temp0
var from_s = self.temp0_s
for r : self.hist
if r[0] <= self.temp_s - 300 && r[0] >= from_s
from_s = r[0]
from_v = r[1]
end
end
var rise = self.temp - from_v
if rise > 0 && self.temp_s > from_s && (unix / 3) % 2 == 1
var at = self.temp_s + int((self.ready - self.temp) * (self.temp_s - from_s) / rise)
if at > unix
self.bar = nil
self.line2 = [[self.clock(at - unix), self.white]]
end
end
elif self.cold && self.since_s > 0
self.line2 = [[self.clock(self.since_s + self.coldpre_s - unix), self.white]]
else
self.line2 = [[self.clock(on_s), self.white]]
end
return
end
var off = 0
if self.idle_at > self.since_s
off = self.idle_at
elif self.idle_at == 0 && self.idle_len > 0
off = unix + self.idle_len
end
if self.over_at > self.since_s && (off == 0 || self.over_at < off)
off = self.over_at
end
var left = off - unix
if off == 0
self.line2 = nil
elif left <= 0
self.line2 = [["OFF", self.warn]]
else
self.line2 = self.pair("OFF", self.clock(left), left < 60 ? self.warn : self.white)
end
end
def draw()
clear()
var now = now_ms()
self.build(now)
var heating = self.shot != "run" && self.warming()
var b = self.cup
var i = 0
var n = size(b)
while i < n
pixel(b[i], b[i + 1], (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4])
i += 5
end
if heating || self.stopped == nil
var step = now / (heating ? 120 : 200)
var c = heating ? self.hot : 0x9A9A9A
var big = height() > 8
for k : 0 .. (big ? 2 : 1)
for y : 0 .. 2
pixel((big ? 4 + 3 * k : 1 + 3 * k) + ((y + step + k) % 4 < 2 ? 0 : 1), y, c)
end
end
end
if height() > 8
if self.line1 != nil
text(17, 6, self.line1)
end
if self.bar != nil
self.draw_bar(9)
elif self.line2 != nil
text(17, 14, self.line2)
end
return
end
var line = self.line1
var second = false
var off = 0
if self.shot == "idle" && self.line1 != nil && self.line2 != nil
var p = now % 4000
if (now / 4000) % 2 == 1
line = self.line2
second = true
end
if p > 3600
off = (p - 3600) * 9 / 400
elif p < 400
off = 8 - p * 8 / 400
end
end
if second && self.bar != nil
self.draw_bar(1 + off)
elif line != nil
text(self.x0 + max(0, (width() - self.x0 - text_width(line) + 1) / 2), 6 + off, line)
end
end
def draw_bar(top)
var room = width() - self.x0
var n = (room + 1) / 3
var start = self.x0 + (room - (n * 3 - 1)) / 2
var full = self.bar * n / 100
var h = self.hot
var dim = ((h >> 16 & 0xFF) * 3 / 8 << 16) | ((h >> 8 & 0xFF) * 3 / 8 << 8) | (h & 0xFF) * 3 / 8
var blink = (now_ms() / 500) % 2 == 1
var k = 0
while k < n
var c = k < full ? h : (k == full && blink ? self.white : dim)
for y : top + 1 .. top + 4
pixel(start + k * 3, y, c)
pixel(start + k * 3 + 1, y, c)
end
k += 1
end
end
end
return ShotTimer()
