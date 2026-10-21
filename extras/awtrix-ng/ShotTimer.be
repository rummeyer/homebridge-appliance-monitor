# @name    ShotTimer
# @desc    Coffee machine from Appliance Monitor: heating up, running time, time until it switches off, and a shot timer
# @author  Oliver Rummeyer
# @version 3.3
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
  var pumped       # the pump has run since it was switched on: in use, not heating up any more
  var below, lead_ms, hold_ms, pin
  var cup          # x, y, red, green, blue of each pixel of the cup and saucer, a byte each
  var x0           # where the text starts: past the 16×16 cup, or the 8×8 one 8 rows high
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
    self.pumped = false
    self.below = store.get("below")
    self.lead_ms = int(store.get("lead") * 1000)
    self.hold_ms = int(store.get("hold") * 1000)
    self.pin = store.get("pin")
    # A white cup with coffee and crema, seen from a little above, on a saucer; 8 rows high, as on
    # the TC001, the cup of LaMetric icon 14199, its steam drawn here.
    self.x0 = height() > 8 ? 17 : 9
    self.cup = bytes(height() <= 8 ?
      "0003FCFAFC0103A4726C0203A4726C0303A4726C0403A4726C0503FCFAFC0603FCFAFC0703FCFAFC0004FCFAFC0104FCFAFC"
      "0204FCFAFC0304FCFAFC0404FCFAFC0504FCFAFC0704FCFAFC0005FCFAFC0105FCFAFC0205FCFAFC0305FCFAFC0405FCFAFC"
      "0505FCFAFC0605FCFAFC0705FCFAFC0106FCFAFC0206FCFAFC0306FCFAFC0406FCFAFC0207FCFAFC0307FCFAFC" :
      "04036E6E6E0503E6E6E60603E6E6E60703E6E6E60803E6E6E60903E6E6E60A03E6E6E60B036E6E6E02046E6E6E0304E6E6E6"
      "04046E341205046E341206046E341207046E341208046E341209046E34120A046E34120B046E34120C04E6E6E60D046E6E6E"
      "0205E6E6E603056E341204056E3412050595501E060595501E0705C88A4E080595501E090595501E0A056E34120B056E3412"
      "0C056E34120D05E6E6E60206FFFFFF0306E6E6E604066E341205066E3412060695501E070695501E080695501E09066E3412"
      "0A066E34120B066E34120C06E6E6E60D06E6E6E60E06E6E6E60207FFFFFF0307E6E6E60407E6E6E60507E6E6E60607E6E6E6"
      "0707E6E6E60807E6E6E60907E6E6E60A07E6E6E60B07E6E6E60C07E6E6E60D07A8A8A80F07E6E6E60208FFFFFF0308E6E6E6"
      "0408E6E6E60508E6E6E60608E6E6E60708E6E6E60808E6E6E60908E6E6E60A08E6E6E60B08E6E6E60C08E6E6E60D08A8A8A8"
      "0F08E6E6E60209FFFFFF0309E6E6E60409E6E6E60509E6E6E60609E6E6E60709E6E6E60809E6E6E60909E6E6E60A09E6E6E6"
      "0B09E6E6E60C09A8A8A80D09E6E6E60E09E6E6E6030AFFFFFF040AE6E6E6050AE6E6E6060AE6E6E6070AE6E6E6080AE6E6E6"
      "090AE6E6E60A0AE6E6E60B0AA8A8A80C0AA8A8A8040BA8A8A8050BE6E6E6060BE6E6E6070BE6E6E6080BE6E6E6090BE6E6E6"
      "0A0BA8A8A80B0BA8A8A8020CA6A6A6030CA6A6A6040C2A2A2A050C2A2A2A060C2A2A2A070C2A2A2A080C2A2A2A090C2A2A2A"
      "0A0C2A2A2A0B0C2A2A2A0C0CA6A6A60D0CA6A6A6010DA6A6A6020DA6A6A6030DA6A6A6040DA6A6A6050DA6A6A6060DA6A6A6"
      "070DA6A6A6080DA6A6A6090DA6A6A60A0DA6A6A60B0DA6A6A60C0DA6A6A60D0DA6A6A60E0DA6A6A6020E5C5C5C030E5C5C5C"
      "040E5C5C5C050E5C5C5C060E5C5C5C070E5C5C5C080E5C5C5C090E5C5C5C0A0E5C5C5C0B0E5C5C5C0C0E5C5C5C0D0E5C5C5C")
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

  # Heating up: until warm enough where the thermometer tells, else while the heating phase is on;
  # not once a coffee has been made, when its OFF countdown matters more.
  def warming()
    return self.running && !self.pumped && !self.heated() && (self.temp != nil || self.heating)
  end

  def machine(t, p)
    if t == self.watts_topic
      self.watts(num(p))
    elif t == self.state_topic
      var was = self.running
      self.running = p == "running"
      if self.running != was
        self.heat_done = false
        self.pumped = false
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
    self.pumped = true
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
    return text_width(both) <= width() - self.x0 ? both : [[value, color]]
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
    var b = self.cup
    var i = 0
    var n = size(b)
    while i < n
      pixel(b[i], b[i + 1], (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4])
      i += 5
    end
    # Heat waves while heating up, steam while it is hot or the pump runs: three wisps over the big
    # cup, two over the small one, where the icon has them.
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
      if self.line2 != nil
        text(17, 14, self.line2)
      end
      return
    end
    # 8 rows high, one line beside the cup: the shot alone, else the two lines taking turns every
    # 4 s, the one sliding down out of sight and the other coming up from the bottom.
    var line = self.line1
    var off = 0
    if self.shot == "idle" && self.line1 != nil && self.line2 != nil
      var p = now % 4000
      if (now / 4000) % 2 == 1
        line = self.line2
      end
      if p > 3600
        off = (p - 3600) * 9 / 400
      elif p < 400
        off = 8 - p * 8 / 400
      end
    end
    if line != nil
      text(self.x0 + max(0, (width() - self.x0 - text_width(line) + 1) / 2), 6 + off, line)
    end
  end
end
return ShotTimer()
