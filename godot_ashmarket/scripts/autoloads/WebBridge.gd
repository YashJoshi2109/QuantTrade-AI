## WebBridge — JavaScript ↔ Godot communication layer
## Autoload singleton. Uses JavaScriptBridge for HTML5 export.
## Falls back to mock data in native builds.
extends Node

var _js_available: bool = false
var _callback_ref: JavaScriptObject = null

func _ready() -> void:
	_js_available = OS.has_feature("web")
	EventBus.web_data_send_requested.connect(_on_send_requested)

	if _js_available:
		_setup_js_callback()
		_request_initial_data()
	else:
		# Native dev: load mock data after one frame
		await get_tree().process_frame
		_load_mock_data()

# ── JS → Godot ────────────────────────────────────────────────────────────────

func _setup_js_callback() -> void:
	# Expose receiveWebData() so JS can call it
	_callback_ref = JavaScriptBridge.create_callback(_on_js_message)
	JavaScriptBridge.get_interface("window").godotReceive = _callback_ref

func _on_js_message(args: Array) -> void:
	if args.is_empty():
		return
	var raw = args[0]
	var data: Dictionary = {}
	# Parse JSON string if needed
	if raw is String:
		var result := JSON.parse_string(raw)
		if result is Dictionary:
			data = result
	elif raw is Dictionary:
		data = raw
	EventBus.web_data_received.emit(data)

func _request_initial_data() -> void:
	if not _js_available:
		return
	JavaScriptBridge.eval("if(window.godotReady) window.godotReady();", true)

# ── Godot → JS ────────────────────────────────────────────────────────────────

func _on_send_requested(event: String, data: Dictionary) -> void:
	if _js_available:
		_send_to_js(event, data)
	else:
		print("[WebBridge] (dev) event=%s data=%s" % [event, JSON.stringify(data)])

func _send_to_js(event: String, data: Dictionary) -> void:
	var payload := JSON.stringify({"event": event, "data": data})
	var script := "if(window.godotEvent) window.godotEvent(%s);" % payload
	JavaScriptBridge.eval(script, true)

# ── Mock data for native editor testing ───────────────────────────────────────

func _load_mock_data() -> void:
	var mock := {
		"gold": 50,
		"savings": 0,
		"emergency": 0,
		"debt": 0,
		"xp": 0,
		"level": 1,
		"day_number": 1,
		"streak": 0,
		"character_name": "Apprentice",
		"avatar_style": "scholar",
		"goal_label": "Roof Fund",
		"goal_saved": 0,
		"goal_target": 100,
		"completed_chapters": [],
	}
	EventBus.web_data_received.emit(mock)
