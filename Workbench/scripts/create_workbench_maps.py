# -*- coding: utf-8 -*-
# SceneWorkbench 内置地图创建脚本（UE 5.7 / UnrealEditor-Cmd -run=pythonscript 执行）
# 创建两张地图：00_MaterialPreview（展台+灯光+预览材质）、01_SceneBuild（空白主场景）

import unreal
import traceback

def log(s):
    unreal.log("[WorkbenchSetup] " + str(s))

def create_preview_material():
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    package_path = "/Game/Assets/Materials"
    mat_name = "M_Preview"
    mi_name = "MI_Preview"
    mat_path = package_path + "/" + mat_name
    mi_path = package_path + "/" + mi_name

    for p in (mat_path, mi_path):
        if unreal.EditorAssetLibrary.does_asset_exist(p):
            unreal.EditorAssetLibrary.delete_asset(p)

    mat = tools.create_asset(mat_name, package_path, unreal.Material, unreal.MaterialFactoryNew())
    if mat is None:
        log("FAIL: create M_Preview")
        return None
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)

    params = [
        ("BaseColor", unreal.MaterialProperty.MP_BASE_COLOR, False),
        ("Normal", unreal.MaterialProperty.MP_NORMAL, True),
        ("Roughness", unreal.MaterialProperty.MP_ROUGHNESS, False),
        ("Metallic", unreal.MaterialProperty.MP_METALLIC, False),
        ("AO", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION, False),
    ]
    for i, (pname, prop, is_normal) in enumerate(params):
        expr = unreal.MaterialEditingLibrary.create_material_expression(
            mat, unreal.MaterialExpressionTextureSampleParameter2D, -500, i * -200 - 400)
        if expr is None:
            log("FAIL: expr " + pname)
            continue
        expr.set_editor_property("parameter_name", pname)
        expr.set_editor_property("group", "Preview")
        # 5.7 Python API 无 unreal.SamplerType 枚举，法线通道在导入端设置即可，这里跳过
        ok = unreal.MaterialEditingLibrary.connect_material_property(expr, "RGB", prop)
        log("connect %s -> %s : %s" % (pname, str(prop), ok))

    unreal.MaterialEditingLibrary.recompile_material(mat)
    unreal.EditorAssetLibrary.save_asset(mat_path)
    log("M_Preview saved")

    mi = tools.create_asset(mi_name, package_path, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    if mi is None:
        log("FAIL: create MI_Preview")
        return None
    unreal.MaterialEditingLibrary.set_material_instance_parent(mi, mat)
    unreal.EditorAssetLibrary.save_asset(mi_path)
    log("MI_Preview saved")
    return mi

def spawn_static_mesh(mesh_path, location, scale=(1, 1, 1), rotation=(0, 0, 0), material=None):
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    mesh = unreal.load_asset(mesh_path)
    if mesh is None:
        log("FAIL: load mesh " + mesh_path)
        return None
    actor = subsystem.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(*location), unreal.Rotator(*rotation))
    if actor is None:
        log("FAIL: spawn " + mesh_path)
        return None
    comp = actor.static_mesh_component
    comp.set_editor_property("static_mesh", mesh)
    actor.set_actor_scale3d(unreal.Vector(*scale))
    if material is not None:
        comp.set_material(0, material)
    return actor

def setup_material_preview_level():
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)

    mi = create_preview_material()

    # 地面（大平面）
    spawn_static_mesh("/Engine/BasicShapes/Plane", (0, 0, 0), scale=(10, 10, 1))
    # 展台
    spawn_static_mesh("/Engine/BasicShapes/Cube", (0, 0, 50), scale=(5, 5, 1))
    # 球体（展台上，套预览材质）
    spawn_static_mesh("/Engine/BasicShapes/Sphere", (0, 0, 165), scale=(1.2, 1.2, 1.2), material=mi)
    # 立方体
    spawn_static_mesh("/Engine/BasicShapes/Cube", (250, 0, 110), scale=(2.2, 2.2, 2.2), material=mi)
    # 平面（立板）
    spawn_static_mesh("/Engine/BasicShapes/Plane", (-250, 0, 130), scale=(2, 2, 1), rotation=(0, -90, 0), material=mi)

    # 平行光（太阳）
    sun = subsystem.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 1000), unreal.Rotator(-40, -30, 0))
    if sun:
        sun.set_actor_label("Sun_Light")

    # 天空光
    sky = subsystem.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 1000))
    if sky:
        sky.set_actor_label("Sky_Light")

    # 太阳位置计算（SunPosition 插件）
    try:
        sp = subsystem.spawn_actor_from_class(unreal.SunPosition, unreal.Vector(0, 0, 0))
        if sp:
            sp.set_actor_label("SunPosition")
            log("SunPosition spawned")
    except Exception as e:
        log("sunposition fail: " + str(e))

    level_subsystem.save_current_level()
    log("00_MaterialPreview saved")

def setup_empty_level():
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    subsystem.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 1000), unreal.Rotator(-40, -30, 0))
    subsystem.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 1000))
    level_subsystem.save_current_level()
    log("01_SceneBuild saved")

def main():
    level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    log("=== start creating maps ===")

    map_list = ["/Game/Maps/01_SceneBuild", "/Game/Maps/00_MaterialPreview"]
    for m in map_list:
        if unreal.EditorAssetLibrary.does_asset_exist(m):
            unreal.EditorAssetLibrary.delete_asset(m)
            log("deleted existing map: " + m)

    # 01_SceneBuild
    level_subsystem.new_level("/Game/Maps/01_SceneBuild")
    setup_empty_level()

    # 00_MaterialPreview
    level_subsystem.new_level("/Game/Maps/00_MaterialPreview")
    setup_material_preview_level()

    log("=== ALL MAPS DONE ===")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("ERROR: " + traceback.format_exc())
