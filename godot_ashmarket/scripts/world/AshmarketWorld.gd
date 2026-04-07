## AshmarketWorld — Main scene controller for the Ashmarket 3D world
## Attach to the root Node3D of AshmarketWorld.tscn
extends Node3D

# ── Camera ────────────────────────────────────────────────────────────────────
@onready var camera: Camera3D = $IsometricCamera
@onready var camera_pivot: Node3D = $CameraPivot

# Camera pan/zoom constants
const CAM_ANGLE_X := -45.0    # isometric pitch
const CAM_ZOOM_DEFAULT := 15.0
const CAM_ZOOM_MIN := 8.0
const CAM_ZOOM_MAX := 25.0
const CAM_PAN_SPEED := 12.0
const CAM_EDGE_MARGIN := 40.0 # px from viewport edge to begin panning

@export var world_bounds: Rect2 = Rect2(-20, -20, 40, 40)

var _zoom: float = CAM_ZOOM_DEFAULT
var _pan_velocity: Vector2 = Vector2.ZERO

# ── Coin burst pool ───────────────────────────────────────────────────────────
const CoinScene := preload("res://scenes/fx/CoinBurst.tscn") if ResourceLoader.exists("res://scenes/fx/CoinBurst.tscn") else null

func _ready() -> void:
	_setup_camera()
	GameManager.change_state(GameManager.GameState.WORLD_EXPLORE)

	EventBus.coin_burst_requested.connect(_spawn_coin_burst)
	EventBus.camera_shake_requested.connect(_shake_camera)
	EventBus.chapter_completed.connect(_on_chapter_completed)
	EventBus.web_data_received.connect(_on_web_ready)

func _on_web_ready(_data: Dictionary) -> void:
	# Web data already applied to PlayerData by GameManager._on_web_data
	GameManager.change_state(GameManager.GameState.WORLD_EXPLORE)

# ── Camera setup ──────────────────────────────────────────────────────────────

func _setup_camera() -> void:
	if camera_pivot:
		camera_pivot.rotation_degrees.x = CAM_ANGLE_X
	if camera:
		camera.position.z = _zoom

func _process(delta: float) -> void:
	_handle_camera_pan(delta)
	_handle_camera_zoom()

func _handle_camera_pan(delta: float) -> void:
	if not camera_pivot:
		return
	var vp_size := get_viewport().get_visible_rect().size
	var mouse := get_viewport().get_mouse_position()
	var dir := Vector2.ZERO

	if mouse.x < CAM_EDGE_MARGIN:
		dir.x = -1
	elif mouse.x > vp_size.x - CAM_EDGE_MARGIN:
		dir.x = 1
	if mouse.y < CAM_EDGE_MARGIN:
		dir.y = -1
	elif mouse.y > vp_size.y - CAM_EDGE_MARGIN:
		dir.y = 1

	# WASD pan
	dir.x += Input.get_axis("move_left", "move_right")
	dir.y += Input.get_axis("move_forward", "move_back")

	if dir != Vector2.ZERO:
		var move := Vector3(dir.x, 0, dir.y) * CAM_PAN_SPEED * delta
		var new_pos := camera_pivot.position + move
		new_pos.x = clampf(new_pos.x, world_bounds.position.x, world_bounds.position.x + world_bounds.size.x)
		new_pos.z = clampf(new_pos.z, world_bounds.position.y, world_bounds.position.y + world_bounds.size.y)
		camera_pivot.position = new_pos

func _handle_camera_zoom() -> void:
	if not camera:
		return
	var scroll := Input.get_axis("zoom_in", "zoom_out") if InputMap.has_action("zoom_in") else 0.0
	_zoom = clampf(_zoom + scroll * 0.5, CAM_ZOOM_MIN, CAM_ZOOM_MAX)
	camera.position.z = lerp(camera.position.z, _zoom, 0.15)

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_zoom = clampf(_zoom - 1.5, CAM_ZOOM_MIN, CAM_ZOOM_MAX)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_zoom = clampf(_zoom + 1.5, CAM_ZOOM_MIN, CAM_ZOOM_MAX)

# ── Chapter completed visual response ─────────────────────────────────────────

func _on_chapter_completed(chapter_id: String, outcome: Dictionary) -> void:
	var xp: int = outcome.get("xp", 0)
	if xp > 0:
		EventBus.camera_shake_requested.emit(0.15, 0.3)
	# Delay return to world state after reflection
	await get_tree().create_timer(1.0).timeout
	if GameManager.current_state == GameManager.GameState.REFLECTION:
		GameManager.change_state(GameManager.GameState.WORLD_EXPLORE)

# ── Visual effects ────────────────────────────────────────────────────────────

func _spawn_coin_burst(world_pos: Vector3, amount: int) -> void:
	if CoinScene == null:
		return
	var burst: Node3D = CoinScene.instantiate()
	add_child(burst)
	burst.global_position = world_pos
	if burst.has_method("set_amount"):
		burst.set_amount(amount)

var _shake_tween: Tween = null

func _shake_camera(intensity: float, duration: float) -> void:
	if not camera:
		return
	if _shake_tween:
		_shake_tween.kill()
	_shake_tween = create_tween()
	var steps := int(duration / 0.04)
	for i in steps:
		var offset := Vector3(
			randf_range(-intensity, intensity),
			randf_range(-intensity * 0.5, intensity * 0.5),
			0
		)
		_shake_tween.tween_property(camera, "position", camera.position + offset, 0.04)
	_shake_tween.tween_property(camera, "position", Vector3(0, 0, _zoom), 0.1)
