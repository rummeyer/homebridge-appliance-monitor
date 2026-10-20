# @name    ShotTimer
# @desc    Coffee machine from Appliance Monitor: heating up, running time, time until it switches off, and a shot timer
# @author  Oliver Rummeyer
# @version 3.0
# @display 52x16
# Source and setup: https://github.com/rummeyer/homebridge-appliance-monitor/tree/main/extras/awtrix-ng
# @config  base   text   "Appliance topic"  default="appliance-monitor/Kaffeemaschine" help="Its state, since, watts, phase and idle/overtime topics"
# @config  shot   text   "Shot topic"       default="shot-timer" help="Appliance Monitor sends <topic>/start and <topic>/end with the seconds"
# @config  heat   text   "Heating phase"    default="Aufheizen"
# @config  rinse  text   "Rinse phase"      default="Spülen" help="A pump run that turns out to be this phase is shown as RINSE"
# @config  below  number "Pump off below"   default=30 min=0 max=3000 unit=W help="The count stops when the plug reads less"
# @config  lead   number "Plug delay"       default=5 min=0 max=30 unit=s help="The Eve Energy reports a 6 s average, so the pump started this much earlier"
# @config  temp   text   "Temperature topic" default="deconz/Kaffeemaschine/temperature" help="Empty: heated once the heating phase ends"
# @config  ready  number "Preheated from"   default=38 min=0 max=100 unit=°C
# @config  hold   number "Show result for"  default=20 min=1 max=600 unit=s
# @config  pin    bool   "Stay on screen while on" default=false help="Off: shown in the rotation, and only the shot takes over"
# @config  done   color  "Result"           default=#30D158
# @config  hot    color  "Heating"          default=#FF8C00
# @config  red    color  "Heated"           default=#FF3B30
class ShotTimer
  var start_topic, end_topic, state_topic, since_topic, watts_topic, heat_topic, idle_topic, over_topic
  var rinse_topic, rinsed
  var temp_topic, ready, temp   # the temperature, nil until one came
  var heat_done    # the heating phase has ended since it was switched on: heated, without a thermometer
  var below, lead_ms, hold_ms, pin
  var cup          # x, y, colour of each pixel of the cup and saucer, one after the other
  var done, hot, red, white, grey, warn
  var shot         # "idle", "run" or "done"
  var t0           # now_ms() when the pump started
  var stopped      # now_ms() when the watts said it stopped, or nil
  var final_s      # the plugin's own count at the end
  var running      # the machine is on
  var known        # a state has come at all; the first is the retained one, not a change
  var since_s      # Unix seconds it has been in its state since, 0 if not known
  var heating      # the heating phase is on
  var idle_at, over_at   # Unix seconds Idle / Overtime turn on, 0 for none
  var built        # the second the lines were built for
  var shown        # the shot's seconds the lines were built for
  var line1, line2 # lists of [text, colour], or nil
  var timer_id
  var visible      # on the display now

  def init()
    var base = store.get("base")
    var shot = store.get("shot")
    self.start_topic = shot + "/start"
    self.end_topic = shot + "/end"
    self.state_topic = base + "/state"
    self.since_topic = base + "/since"
    self.watts_topic = base + "/watts"
    self.heat_topic = base + "/phase/" + store.get("heat")
    self.idle_topic = base + "/idle/at"
    self.over_topic = base + "/overtime/at"
    self.rinse_topic = base + "/phase/" + store.get("rinse")
    self.rinsed = false
    self.temp_topic = store.get("temp")
    self.ready = store.get("ready")
    self.temp = nil
    self.heat_done = false
    self.below = store.get("below")
    self.lead_ms = int(store.get("lead") * 1000)
    self.hold_ms = int(store.get("hold") * 1000)
    self.pin = store.get("pin")
    # A white cup with coffee and crema, seen from a little above, on a saucer.
    self.cup = [
      4, 3, 0x6E6E6E, 5, 3, 0xE6E6E6, 6, 3, 0xE6E6E6, 7, 3, 0xE6E6E6, 8, 3, 0xE6E6E6, 9, 3, 0xE6E6E6, 10, 3, 0xE6E6E6, 11, 3, 0x6E6E6E,
      2, 4, 0x6E6E6E, 3, 4, 0xE6E6E6, 4, 4, 0x6E3412, 5, 4, 0x6E3412, 6, 4, 0x6E3412, 7, 4, 0x6E3412, 8, 4, 0x6E3412, 9, 4, 0x6E3412, 10, 4, 0x6E3412, 11, 4, 0x6E3412, 12, 4, 0xE6E6E6, 13, 4, 0x6E6E6E,
      2, 5, 0xE6E6E6, 3, 5, 0x6E3412, 4, 5, 0x6E3412, 5, 5, 0x95501E, 6, 5, 0x95501E, 7, 5, 0xC88A4E, 8, 5, 0x95501E, 9, 5, 0x95501E, 10, 5, 0x6E3412, 11, 5, 0x6E3412, 12, 5, 0x6E3412, 13, 5, 0xE6E6E6,
      2, 6, 0xFFFFFF, 3, 6, 0xE6E6E6, 4, 6, 0x6E3412, 5, 6, 0x6E3412, 6, 6, 0x95501E, 7, 6, 0x95501E, 8, 6, 0x95501E, 9, 6, 0x6E3412, 10, 6, 0x6E3412, 11, 6, 0x6E3412, 12, 6, 0xE6E6E6, 13, 6, 0xE6E6E6, 14, 6, 0xE6E6E6,
      2, 7, 0xFFFFFF, 3, 7, 0xE6E6E6, 4, 7, 0xE6E6E6, 5, 7, 0xE6E6E6, 6, 7, 0xE6E6E6, 7, 7, 0xE6E6E6, 8, 7, 0xE6E6E6, 9, 7, 0xE6E6E6, 10, 7, 0xE6E6E6, 11, 7, 0xE6E6E6, 12, 7, 0xE6E6E6, 13, 7, 0xA8A8A8, 15, 7, 0xE6E6E6,
      2, 8, 0xFFFFFF, 3, 8, 0xE6E6E6, 4, 8, 0xE6E6E6, 5, 8, 0xE6E6E6, 6, 8, 0xE6E6E6, 7, 8, 0xE6E6E6, 8, 8, 0xE6E6E6, 9, 8, 0xE6E6E6, 10, 8, 0xE6E6E6, 11, 8, 0xE6E6E6, 12, 8, 0xE6E6E6, 13, 8, 0xA8A8A8, 15, 8, 0xE6E6E6,
      2, 9, 0xFFFFFF, 3, 9, 0xE6E6E6, 4, 9, 0xE6E6E6, 5, 9, 0xE6E6E6, 6, 9, 0xE6E6E6, 7, 9, 0xE6E6E6, 8, 9, 0xE6E6E6, 9, 9, 0xE6E6E6, 10, 9, 0xE6E6E6, 11, 9, 0xE6E6E6, 12, 9, 0xA8A8A8, 13, 9, 0xE6E6E6, 14, 9, 0xE6E6E6,
      3, 10, 0xFFFFFF, 4, 10, 0xE6E6E6, 5, 10, 0xE6E6E6, 6, 10, 0xE6E6E6, 7, 10, 0xE6E6E6, 8, 10, 0xE6E6E6, 9, 10, 0xE6E6E6, 10, 10, 0xE6E6E6, 11, 10, 0xA8A8A8, 12, 10, 0xA8A8A8,
      4, 11, 0xA8A8A8, 5, 11, 0xE6E6E6, 6, 11, 0xE6E6E6, 7, 11, 0xE6E6E6, 8, 11, 0xE6E6E6, 9, 11, 0xE6E6E6, 10, 11, 0xA8A8A8, 11, 11, 0xA8A8A8,
      2, 12, 0xA6A6A6, 3, 12, 0xA6A6A6, 4, 12, 0x2A2A2A, 5, 12, 0x2A2A2A, 6, 12, 0x2A2A2A, 7, 12, 0x2A2A2A, 8, 12, 0x2A2A2A, 9, 12, 0x2A2A2A, 10, 12, 0x2A2A2A, 11, 12, 0x2A2A2A, 12, 12, 0xA6A6A6, 13, 12, 0xA6A6A6,
      1, 13, 0xA6A6A6, 2, 13, 0xA6A6A6, 3, 13, 0xA6A6A6, 4, 13, 0xA6A6A6, 5, 13, 0xA6A6A6, 6, 13, 0xA6A6A6, 7, 13, 0xA6A6A6, 8, 13, 0xA6A6A6, 9, 13, 0xA6A6A6, 10, 13, 0xA6A6A6, 11, 13, 0xA6A6A6, 12, 13, 0xA6A6A6, 13, 13, 0xA6A6A6, 14, 13, 0xA6A6A6,
      2, 14, 0x5C5C5C, 3, 14, 0x5C5C5C, 4, 14, 0x5C5C5C, 5, 14, 0x5C5C5C, 6, 14, 0x5C5C5C, 7, 14, 0x5C5C5C, 8, 14, 0x5C5C5C, 9, 14, 0x5C5C5C, 10, 14, 0x5C5C5C, 11, 14, 0x5C5C5C, 12, 14, 0x5C5C5C, 13, 14, 0x5C5C5C]
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
    self.heating = false
    self.idle_at = 0
    self.over_at = 0
    self.built = -1
    self.shown = -1
    self.line1 = nil
    self.line2 = nil
    self.timer_id = nil
    self.visible = false
  end

  def setup()
    mqtt.subscribe(self.start_topic, / t, p -> self.started(num(p, 0)))
    mqtt.subscribe(self.end_topic, / t, p -> self.ended(num(p, 0)))
    mqtt.subscribe(store.get("base") + "/#", / t, p -> self.machine(t, p))
    if self.temp_topic != ""
      mqtt.subscribe(self.temp_topic, / t, p -> self.temperature(num(p)))
    end
  end

  def temperature(v)
    if v != nil
      self.temp = v
      self.built = -1
    end
  end

  # Preheated: warm enough where there is a thermometer, else once the heating phase has ended.
  def heated()
    return self.temp != nil ? self.temp >= self.ready : self.heat_done
  end

  # Heating up: until warm enough where the thermometer tells, else while the heating phase is on.
  def warming()
    return self.running && !self.heated() && (self.temp != nil || self.heating)
  end

  def machine(t, p)
    if t == self.watts_topic
      self.watts(num(p))
    elif t == self.state_topic
      var was = self.running
      self.running = p == "running"
      if self.running != was
        self.heat_done = false
        # The since that came before is the old state's; the new one follows right after.
        if self.known
          self.since_s = 0
        end
        if self.running && self.pin
          rotation.show()
          rotation.pause()
        elif !self.running && self.shot == "idle"
          self.leave()
        end
      end
      self.known = true
    elif t == self.since_topic
      self.since_s = num(p, 0)
    elif t == self.heat_topic
      var on = p == "ON"
      # The first heating of the morning; a reheat later is not "heating up".
      if self.heating && !on && self.running
        self.heat_done = true
      end
      self.heating = on
    elif t == self.rinse_topic
      # A rinse is known once it is over: as the pump's end comes, just before or after.
      if p == "ON" && self.shot != "idle"
        self.rinsed = true
      end
    elif t == self.idle_topic
      self.idle_at = num(p, 0)
    elif t == self.over_topic
      self.over_at = num(p, 0)
    end
    self.built = -1
  end

  # The pump has been in its range for `seconds` already when the plugin knows.
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
    self.shot = "idle"
    self.stopped = nil
    self.timer_id = nil
    self.built = -1
    if !(self.pin && self.running)
      self.leave()
    end
  end

  # Frozen while the plug reads below the pump: nothing runs. The heater runs
  # beside the pump during a coffee, so a reading above it counts on.
  def watts(w)
    if self.shot != "run" || w == nil
      return
    end
    if w < self.below
      if self.stopped == nil
        self.stopped = now_ms()
      end
    else
      self.stopped = nil
    end
  end

  # Never stuck if the end got lost: a pump does not run for ten minutes.
  def loop()
    if self.shot == "run" && now_ms() - self.t0 > 600000
      self.finish()
    end
  end

  # Off the display, and any hold of it let go: nothing left to show.
  def leave()
    rotation.resume()
    if self.visible
      rotation.next()
    end
  end

  # Brought up while there is nothing to show — a hold from before, or by hand: on to the next.
  def on_show()
    self.visible = true
    if !self.should_show()
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

  # A label and a value on one line, or the value alone where both do not fit.
  def pair(label, value, color)
    var both = [[label + " ", self.grey], [value, color]]
    return text_width(both) <= 35 ? both : [[value, color]]
  end

  # Seconds as a shot reads them: "23s", from a minute on "1:05".
  def secs(s)
    return s < 60 ? str(s) + "s" : self.clock(s)
  end

  # The two lines, built when a second has passed or the shot has counted on,
  # rather than every frame.
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
    if !self.running && self.shot == "idle"
      self.line1 = nil
      self.line2 = nil
      return
    end
    var on_s = self.since_s > 0 ? unix - self.since_s : 0
    var heating = self.warming()
    # Line 1: the shot while it runs and a while after, else heating up, else
    # every three seconds the other one of how long it has been on and how long
    # heating took.
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
    # Line 2: while heating up, how long it has been on; else when it is
    # switched off, by whichever comes first. One from before it was switched
    # on is stale.
    if heating
      self.line2 = [[self.clock(on_s), self.white]]
      return
    end
    var off = 0
    if self.idle_at > self.since_s
      off = self.idle_at
    end
    if self.over_at > self.since_s && (off == 0 || self.over_at < off)
      off = self.over_at
    end
    if off == 0
      self.line2 = nil
    else
      var left = off - unix
      self.line2 = self.pair("OFF", self.clock(left), left < 60 ? self.warn : self.white)
    end
  end

  def draw()
    clear()
    var now = now_ms()
    self.build(now)
    var heating = self.shot != "run" && self.warming()
    var i = 0
    var n = size(self.cup)
    while i < n
      pixel(self.cup[i], self.cup[i + 1], self.cup[i + 2])
      i += 3
    end
    # Heat waves while heating up, steam while it is hot or the pump runs.
    if heating || self.stopped == nil
      var step = now / (heating ? 120 : 200)
      var c = heating ? self.hot : 0x9A9A9A
      for k : 0 .. 2
        for y : 0 .. 2
          pixel(4 + 3 * k + ((y + step + k) % 4 < 2 ? 0 : 1), y, c)
        end
      end
    end
    if self.line1 != nil
      text(17, 6, self.line1)
    end
    if self.line2 != nil
      text(17, 14, self.line2)
    end
  end
end
return ShotTimer()
