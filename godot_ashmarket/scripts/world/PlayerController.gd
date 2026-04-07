## PlayerController — Isometric click-to-move character
## Attach to CharacterBody3D player node.
class_name PlayerController
extends CharacterBody3D

@export var move_speed: float = 5.0
@export var rotation_speed: float = 12.0
@export var click_plane_y: float = 0.0   # world Y of the ground plane

@onready var animation_player: AnimationPlayer = $AnimationPlayer
@onready var mesh: Node3D = $Mesh

var _target_position: Vector3 = Vector3.ZERO
var _moving: bool = false
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")

# Click marker (small disc shown at target)
var _click_marker: MeshInstance3D = null

func _ready() -> void:
	add_to_group("player")
	_target_position = global_position
	_build_click_marker()

func _physics_process(delta: float) -> void:
	# Gravity
	if not is_on_floor():
		velocity.y -= _gravity * delta

	if _moving:
		var flat_pos := Vector3(global_position.x, 0, global_position.z)
		var flat_target := Vector3(_target_position.x, 0, _target_position.z)
		var dist := flat_pos.distance_to(flat_target)

		if dist < 0.15:
			_moving = false
			velocity.x = 0
			velocity.z = 0
			_play_anim("idle")
			if _click_marker:
				_click_marker.visible = false
		else:
			var dir := (flat_target - flat_pos).normalized()
			velocity.x = dir.x * move_speed
			velocity.z = dir.z * move_speed

			# Smooth rotation to face movement direction
			var target_angle := atan2(dir.x, dir.z)
			if mesh:
				var current := mesh.rotation.y
				mesh.rotation.y = lerp_angle(current, target_angle, rotation_speed * delta)

			_play_anim("walk")

	move_and_slide()

func _unhandled_input(event: InputEvent) -> void:
	if GameManager.current_state == GameManager.GameState.DIALOGUE or \
	   GameManager.current_state == GameManager.GameState.CHAPTER_ACTIVE:
		return

	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		var camera := get_viewport().get_camera_3d()
		if not camera:
			return
		var ray_origin := camera.project_ray_origin(event.position)
		var ray_dir := camera.project_ray_normal(event.position)
		# Intersect with ground plane y=click_plane_y
		if abs(ray_dir.y) < 0.001:
			return
		var t := (click_plane_y - ray_origin.y) / ray_dir.y
		if t < 0:
			return
		var hit := ray_origin + ray_dir * t
		move_to(hit)

func move_to(world_pos: Vector3) -> void:
	_target_position = Vector3(world_pos.x, global_position.y, world_pos.z)
	_moving = true
	if _click_marker:
		_click_marker.global_position = Vector3(world_pos.x, click_plane_y + 0.02, world_pos.z)
		_click_marker.visible = true

var _last_anim: String = ""
func _play_anim(name: String) -> void:
	if not animation_player or _last_anim == name:
		return
	_last_anim = name
	if animation_player.has_animation(name):
		animation_player.play(name)

func _build_click_marker() -> void:
	_click_marker = MeshInstance3D.new()
	var disc := CylinderMesh.new()
	disc.top_radius = 0.3
	disc.bottom_radius = 0.3
	disc.height = 0.02
	_click_marker.mesh = disc
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(1, 0.85, 0.2, 0.7)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_click_marker.material_override = mat
	_click_marker.visible = false
	get_tree().current_scene.add_child(_click_marker)
