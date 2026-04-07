# Godot Scene Structure

## AshmarketWorld.tscn (root)
```
Node3D (root) — AshmarketWorld.gd
├── CameraPivot (Node3D)
│   └── IsometricCamera (Camera3D)
├── DirectionalLight3D
├── WorldEnvironment
├── Buildings (Node3D)
│   ├── MarketStall (StaticBody3D) — Building.gd [building_id="market_stall"]
│   │   ├── MeshInstance3D
│   │   ├── CollisionShape3D
│   │   ├── InteractionArea (Area3D)
│   │   │   └── CollisionShape3D (sphere r=3.0)
│   │   ├── HighlightMesh (MeshInstance3D)
│   │   └── Label3D
│   ├── Treasury (StaticBody3D) — Building.gd [building_id="treasury"]
│   ├── GuildHall (StaticBody3D) — Building.gd [building_id="guild_hall"]
│   ├── Home (StaticBody3D) — Building.gd [building_id="home"]
│   └── TradeCaravan (StaticBody3D) — Building.gd [building_id="trade_caravan"]
├── Player (CharacterBody3D) — PlayerController.gd [groups: player]
│   ├── AnimationPlayer
│   ├── Mesh (Node3D)
│   └── CollisionShape3D (capsule)
└── HUD (CanvasLayer) — GameHUD.gd
    ├── GoldLabel (%GoldLabel)
    ├── SavingsLabel (%SavingsLabel)
    ├── XPBar (%XPBar)
    ├── XPLabel (%XPLabel)
    ├── LevelLabel (%LevelLabel)
    ├── DayLabel (%DayLabel)
    ├── StreakLabel (%StreakLabel)
    ├── DebtLabel (%DebtLabel)
    └── ToastContainer (%ToastContainer)

## DialogueBox.tscn (added as child of root or HUD CanvasLayer)
```
CanvasLayer
└── Control (DialogueBox.gd)
    └── Panel (PanelContainer)
        └── VBox (VBoxContainer)
            ├── Header (HBoxContainer)
            │   ├── Portrait (TextureRect)
            │   └── NPCName (Label)
            ├── DialogueText (RichTextLabel)
            └── Choices (VBoxContainer)
```

## Export Settings (HTML5)
- Renderer: GL Compatibility (WebGL 2.0)
- Export as single .html file + supporting .js/.wasm
- Custom HTML shell: embed in Next.js iframe at /game/godot
- JavaScript bridge: window.godotReady() / window.godotEvent(payload)
