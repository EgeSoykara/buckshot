"""Build the browser-ready Last Chamber asset kit in Blender.

Run inside Blender 5.x. The file is intentionally deterministic: it creates the
six cast members, the shotgun and every gameplay item, then exports one GLB.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "assets" / "last-chamber-kit.glb"
BLEND_OUTPUT = ROOT / "blender" / "last-chamber-kit.blend"


def reset_scene() -> None:
    # Direct data-block removal also clears hidden/unselectable objects left by
    # an interrupted MCP run. Operator-only deletion can silently retain them
    # and produce duplicate GLB asset roots on the next export.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for datablocks in (bpy.data.materials, bpy.data.curves, bpy.data.meshes, bpy.data.images):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def albedo_texture(name: str, color: tuple[float, float, float, float], size: int = 96) -> bpy.types.Image:
    """Create a compact, deterministic albedo map that survives glTF export."""
    rng = random.Random(name)
    lower_name = name.lower()
    pixels: list[float] = []
    freckles = {(rng.randrange(size), rng.randrange(size)) for _ in range(42)}
    for y in range(size):
        for x in range(size):
            grain = rng.uniform(-.075, .075)
            if "wood" in lower_name:
                grain += math.sin(y * .18 + math.sin(x * .06) * 2.4) * .13
            elif any(token in lower_name for token in ("metal", "steel", "silver", "brass", "gun")):
                grain += (math.sin(y * 1.7 + x * .035) * .035) - (.18 if (x + y * 7) % 83 == 0 else 0)
            elif any(token in lower_name for token in ("coat", "shirt", "paper")):
                grain += (.055 if x % 5 == 0 else 0) + (.04 if y % 5 == 0 else 0)
            elif "skin" in lower_name:
                grain += -.14 if (x, y) in freckles else math.sin(x * 1.9 + y * .7) * .018
            shade = max(.32, min(1.35, 1 + grain))
            pixels.extend((
                max(0, min(1, color[0] * shade)),
                max(0, min(1, color[1] * shade)),
                max(0, min(1, color[2] * shade)),
                color[3],
            ))
    image = bpy.data.images.new(f"{name}_Albedo", width=size, height=size, alpha=True)
    image.pixels.foreach_set(pixels)
    image.colorspace_settings.name = "sRGB"
    image.pack()
    return image


def surface_maps(name: str, base_roughness: float, size: int = 64) -> tuple[bpy.types.Image, bpy.types.Image]:
    """Generate compact non-color roughness and tangent-space normal maps."""
    lower_name = name.lower()
    rough_pixels: list[float] = []
    normal_pixels: list[float] = []

    def height(x: int, y: int) -> float:
        if "wood" in lower_name:
            return math.sin(y * .24 + math.sin(x * .07) * 2.8) * .8 + math.sin(x * .12) * .18
        if any(token in lower_name for token in ("coat", "shirt", "paper")):
            return math.sin(x * math.pi / 2) * .28 + math.sin(y * math.pi / 2) * .28
        if "skin" in lower_name:
            return math.sin(x * 1.7 + y * .31) * .17 + math.sin(y * 1.9 - x * .27) * .13
        if any(token in lower_name for token in ("metal", "steel", "silver", "brass", "gun")):
            return math.sin(y * 1.45 + x * .035) * .22 + (-.7 if (x + y * 11) % 97 == 0 else 0)
        return math.sin(x * .63 + y * .41) * .12

    for y in range(size):
        for x in range(size):
            center = height(x, y)
            dx = height((x + 1) % size, y) - height((x - 1) % size, y)
            dy = height(x, (y + 1) % size) - height(x, (y - 1) % size)
            strength = .12 if "skin" in lower_name else .19
            nx, ny, nz = -dx * strength, -dy * strength, 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            normal_pixels.extend((nx / length * .5 + .5, ny / length * .5 + .5, nz / length * .5 + .5, 1))
            surface_roughness = max(.04, min(.98, base_roughness + center * .09))
            rough_pixels.extend((surface_roughness, surface_roughness, surface_roughness, 1))

    rough_image = bpy.data.images.new(f"{name}_Roughness", width=size, height=size, alpha=False)
    rough_image.pixels.foreach_set(rough_pixels)
    rough_image.colorspace_settings.name = "Non-Color"
    rough_image.pack()
    normal_image = bpy.data.images.new(f"{name}_Normal", width=size, height=size, alpha=False)
    normal_image.pixels.foreach_set(normal_pixels)
    normal_image.colorspace_settings.name = "Non-Color"
    normal_image.pack()
    return rough_image, normal_image


def material(name: str, color: tuple[float, float, float, float], *, metallic=0.0, roughness=0.55,
             emission: tuple[float, float, float, float] | None = None, emission_strength=0.0,
             transmission=0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    albedo_node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    albedo_node.name = f"{name}_Albedo"
    albedo_node.image = albedo_texture(name, color)
    albedo_node.interpolation = "Linear"
    mat.node_tree.links.new(albedo_node.outputs["Color"], bsdf.inputs["Base Color"])
    rough_image, normal_image = surface_maps(name, roughness)
    rough_node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    rough_node.image = rough_image
    rough_node.interpolation = "Linear"
    rough_node.image.colorspace_settings.name = "Non-Color"
    mat.node_tree.links.new(rough_node.outputs["Color"], bsdf.inputs["Roughness"])
    normal_texture_node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    normal_texture_node.image = normal_image
    normal_texture_node.interpolation = "Linear"
    normal_texture_node.image.colorspace_settings.name = "Non-Color"
    normal_map_node = mat.node_tree.nodes.new("ShaderNodeNormalMap")
    normal_map_node.inputs["Strength"].default_value = .42
    mat.node_tree.links.new(normal_texture_node.outputs["Color"], normal_map_node.inputs["Color"])
    mat.node_tree.links.new(normal_map_node.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.22 if metallic > 0.2 else 0.08
        bsdf.inputs["Coat Roughness"].default_value = min(1.0, roughness + 0.08)
    if transmission and "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = transmission
        bsdf.inputs["IOR"].default_value = 1.45
    if emission and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


MATS: dict[str, bpy.types.Material] = {}


def make_materials() -> None:
    specs = {
        "gunmetal": ((0.055, 0.07, 0.065, 1), .92, .2),
        "worn_steel": ((0.27, 0.3, 0.28, 1), .82, .28),
        "silver": ((0.48, 0.52, 0.5, 1), .9, .22),
        "brass": ((0.46, 0.29, 0.08, 1), .75, .25),
        "wood": ((0.24, 0.075, 0.025, 1), .02, .38),
        "dark_wood": ((0.09, 0.023, 0.012, 1), .01, .48),
        "black": ((0.012, 0.015, 0.014, 1), .38, .42),
        "paper": ((0.57, 0.52, 0.41, 1), 0, .84),
        "bone": ((0.57, 0.52, 0.39, 1), 0, .76),
        "blood": ((0.22, 0.005, 0.003, 1), .02, .38),
        "glass": ((0.12, 0.2, 0.16, .58), .02, .1),
        "liquid": ((0.06, 0.26, 0.18, .9), .02, .15),
        "shell_red": ((0.48, 0.025, 0.016, 1), .03, .43),
        "screen": ((0.03, 0.2, 0.13, 1), .15, .19),
    }
    for name, (color, metalness, roughness) in specs.items():
        kwargs = {}
        if name == "glass":
            kwargs["transmission"] = .55
        if name == "screen":
            kwargs.update(emission=(0.02, .42, .2, 1), emission_strength=2.8)
        if name == "liquid":
            kwargs.update(emission=(0.01, .18, .09, 1), emission_strength=.55, transmission=.18)
        MATS[name] = material(f"LC_{name}", color, metallic=metalness, roughness=roughness, **kwargs)


def empty(name: str, parent=None, *, role: str | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    if role:
        obj["lc_role"] = role
    return obj


def finish_mesh(obj: bpy.types.Object, mat: bpy.types.Material, parent=None, *, role=None, bevel=0.0) -> bpy.types.Object:
    obj.data.materials.append(mat)
    obj.parent = parent
    obj["lc_generated"] = True
    if role:
        obj["lc_role"] = role
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if bevel:
        modifier = obj.modifiers.new("Micro bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def sphere(name, location, scale, mat, parent=None, *, segments=24, rings=16, role=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, mat, parent, role=role)


def cube(name, location, scale, mat, parent=None, *, rotation=(0, 0, 0), bevel=.025, role=None):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, mat, parent, role=role, bevel=bevel)


def cylinder(name, location, radius, depth, mat, parent=None, *, rotation=(0, 0, 0), vertices=24, role=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, mat, parent, role=role, bevel=min(radius * .08, .018))


def cone(name, location, radius1, radius2, depth, mat, parent=None, *, rotation=(0, 0, 0), vertices=18):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth,
                                    location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, mat, parent)


def torus(name, location, major, minor, mat, parent=None, *, rotation=(0, 0, 0), major_segments=28):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=major_segments,
                                    minor_segments=10, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, mat, parent)


def capsule(name, location, radius, length, mat, parent=None, *, rotation=(0, 0, 0), role=None):
    rig = empty(f"{name}_Rig", parent, role=role)
    rig.location = location
    rig.rotation_euler = rotation
    cylinder(f"{name}_Shaft", (0, 0, 0), radius, length, mat, rig, vertices=20)
    sphere(f"{name}_Top", (0, 0, length / 2), (radius, radius, radius), mat, rig, segments=20, rings=12)
    sphere(f"{name}_Bottom", (0, 0, -length / 2), (radius, radius, radius), mat, rig, segments=20, rings=12)
    return rig


def character_materials(character_id: str, coat, skin, accent):
    return {
        "coat": material(f"LC_{character_id}_coat", (*coat, 1), roughness=.78),
        "shirt": material(f"LC_{character_id}_shirt", (coat[0] * .22, coat[1] * .22, coat[2] * .22, 1), roughness=.86),
        "skin": material(f"LC_{character_id}_skin", (*skin, 1), roughness=.58),
        "hair": material(f"LC_{character_id}_hair", (.018, .012, .009, 1), roughness=.9),
        "accent": material(f"LC_{character_id}_accent", (*accent, 1), roughness=.4,
                           emission=(*accent, 1), emission_strength=1.8),
        "eldritch": material(f"LC_{character_id}_eldritch", (accent[0] * .35, accent[1] * .52, accent[2] * .43, 1),
                             roughness=.61, emission=(*accent, 1), emission_strength=.28),
    }


CHARACTERS = {
    "mariner": ((.28, .055, .04), (.42, .19, .12), (.46, .78, .59), "gills", "cap"),
    "witness": ((.035, .18, .27), (.28, .115, .07), (.29, .73, .94), "scar", "glasses"),
    "host": ((.17, .23, .055), (.48, .24, .15), (.62, .74, .24), "third_eye", "beanie"),
    "scholar": ((.25, .07, .25), (.34, .16, .1), (.78, .34, .83), "bone_crown", "patch"),
    "penitent": ((.34, .18, .035), (.47, .2, .11), (.86, .55, .16), "spines", "bandage"),
    "hollow": ((.035, .24, .19), (.25, .12, .08), (.2, .8, .66), "third_eye", "hood"),
}


def build_hand(prefix: str, x: float, parent, mats, role: str):
    hand = empty(f"{prefix}_HandRig", parent, role=role)
    hand.location = (x, .92, .02)
    sphere(f"{prefix}_Palm", (0, 0, 0), (.16, .09, .19), mats["skin"], hand, segments=24, rings=16)
    for index in range(4):
        finger_x = (index - 1.5) * .064
        capsule(f"{prefix}_Finger_{index}", (finger_x, .1, -.16), .024, .18, mats["skin"], hand,
                rotation=(math.radians(-18), 0, 0))
    capsule(f"{prefix}_Thumb", (math.copysign(.15, x), .055, -.04), .031, .15, mats["skin"], hand,
            rotation=(0, math.radians(58) * -math.copysign(1, x), 0))
    return hand


def build_character(character_id: str, index: int) -> None:
    coat, skin_color, accent, mutation, headwear = CHARACTERS[character_id]
    mats = character_materials(character_id, coat, skin_color, accent)
    root = empty(f"Character_{character_id}")
    root["asset_kind"] = "character"
    root["character_id"] = character_id

    chair = empty(f"{character_id}_Chair", root)
    cube(f"{character_id}_ChairBack", (0, -.32, .75), (.78, .12, 1.06), MATS["dark_wood"], chair, bevel=.09)
    cube(f"{character_id}_ChairSeat", (0, .02, -.25), (.82, .7, .12), MATS["wood"], chair, bevel=.1)
    for x in (-.72, .72):
        cube(f"{character_id}_ChairPost_{x}", (x, -.3, -.35), (.08, .08, .82), MATS["brass"], chair, bevel=.025)

    body = empty(f"{character_id}_BodyRig", root, role="body")
    sphere(f"{character_id}_Torso", (0, 0, .68), (.62 + index * .012, .34, .82), mats["coat"], body, segments=32, rings=24)
    sphere(f"{character_id}_Chest", (0, .25, .82), (.51, .12, .58), mats["shirt"], body, segments=28, rings=18)
    for side in (-1, 1):
        cube(f"{character_id}_Lapel_{side}", (side * .23, .355, .92), (.16, .035, .53), mats["coat"], body,
             rotation=(0, side * math.radians(9), side * math.radians(12)), bevel=.035)
        sphere(f"{character_id}_Shoulder_{side}", (side * .58, .01, 1.08), (.24, .29, .25), mats["coat"], body)
        capsule(f"{character_id}_Leg_{side}", (side * .33, -.08, -.29), .23, .66, mats["coat"], body,
                rotation=(0, math.radians(65), 0))
        cube(f"{character_id}_Boot_{side}", (side * .34, .46, -.72), (.22, .45, .2), MATS["black"], body, bevel=.07)
    cube(f"{character_id}_Belt", (0, .1, .1), (.58, .36, .065), MATS["black"], body, bevel=.025)
    for z in (.54, .82, 1.1):
        sphere(f"{character_id}_Button_{z}", (0, .38, z), (.035, .025, .035), mats["accent"], body, segments=12, rings=8)

    head_rig = empty(f"{character_id}_HeadRig", root, role="head")
    capsule(f"{character_id}_Neck", (0, 0, 1.5), .17, .24, mats["skin"], head_rig)
    sphere(f"{character_id}_Head", (0, .03, 1.86), (.42 + index * .006, .36, .5), mats["skin"], head_rig, segments=36, rings=28)
    sphere(f"{character_id}_Jaw", (0, .24, 1.68), (.34, .19, .26), mats["skin"], head_rig, segments=30, rings=20)
    sphere(f"{character_id}_Nose", (0, .39, 1.88), (.075, .13, .16), mats["skin"], head_rig, segments=20, rings=14)
    sphere(f"{character_id}_NoseTip", (0, .49, 1.82), (.09, .07, .07), mats["skin"], head_rig, segments=18, rings=12)
    cube(f"{character_id}_Mouth", (0, .435, 1.62), (.15, .02, .022), MATS["blood"], head_rig, bevel=.012)
    for side in (-1, 1):
        sphere(f"{character_id}_Cheek_{side}", (side * .22, .31, 1.75), (.18, .11, .19), mats["skin"], head_rig)
        sphere(f"{character_id}_Ear_{side}", (side * .41, .01, 1.86), (.075, .04, .13), mats["skin"], head_rig)
        sphere(f"{character_id}_Eye_{side}", (side * .145, .365, 1.99), (.075, .035, .047), mats["accent"], head_rig, segments=18, rings=12)
        cube(f"{character_id}_Brow_{side}", (side * .15, .395, 2.1), (.13, .025, .028), mats["hair"], head_rig,
             rotation=(0, side * math.radians(7), side * math.radians(5)), bevel=.012)
    sphere(f"{character_id}_HairCap", (0, -.03, 2.13), (.43, .34, .28), mats["hair"], head_rig, segments=28, rings=18)
    for strand in range(9):
        x = (strand - 4) * .075
        capsule(f"{character_id}_Hair_{strand}", (x, .25 - abs(x) * .3, 2.18 - abs(x) * .22), .026, .22 + (strand % 3) * .04,
                mats["hair"], head_rig, rotation=(math.radians(12), math.radians(x * 35), math.radians(x * -18)))

    for side, role in ((-1, "leftArm"), (1, "rightArm")):
        arm = empty(f"{character_id}_{role}", body, role=role)
        arm.location = (side * .57, .02, 1.02)
        capsule(f"{character_id}_{role}_Upper", (0, .13, -.25), .16, .42, mats["coat"], arm,
                rotation=(math.radians(-42), 0, side * math.radians(6)))
        capsule(f"{character_id}_{role}_Lower", (side * .08, .53, -.5), .13, .42, mats["coat"], arm,
                rotation=(math.radians(-67), 0, side * math.radians(-5)))
    build_hand(f"{character_id}_Left", -.68, body, mats, "leftHand")
    build_hand(f"{character_id}_Right", .68, body, mats, "rightHand")

    if mutation == "gills":
        for side in (-1, 1):
            for gill in range(3):
                cone(f"{character_id}_Gill_{side}_{gill}", (side * .39, .04, 1.83 - gill * .13), .08, .012, .3,
                     mats["eldritch"], head_rig, rotation=(0, math.radians(90), 0))
    elif mutation == "third_eye":
        sphere(f"{character_id}_ThirdEye", (0, .375, 2.18), (.08, .032, .06), mats["accent"], head_rig)
        torus(f"{character_id}_ThirdEyeRim", (0, .385, 2.18), .11, .018, mats["eldritch"], head_rig,
              rotation=(math.radians(90), 0, 0))
    elif mutation == "bone_crown":
        for side in (-1, 1):
            cone(f"{character_id}_Crown_{side}", (side * .25, -.02, 2.48), .11, .01, .55, MATS["bone"], head_rig,
                 rotation=(0, side * math.radians(14), 0))
    elif mutation == "spines":
        for side in (-1, 1):
            for spine in range(3):
                cone(f"{character_id}_Spine_{side}_{spine}", (side * (.58 + spine * .06), -.09, 1.16 - spine * .2),
                     .08, .01, .34, MATS["bone"], body, rotation=(0, side * math.radians(58), 0))
    elif mutation == "scar":
        cube(f"{character_id}_Scar", (-.16, .405, 1.96), (.015, .012, .23), MATS["blood"], head_rig,
             rotation=(0, math.radians(-8), math.radians(-18)), bevel=.006)

    if headwear == "cap":
        sphere(f"{character_id}_Cap", (0, -.01, 2.25), (.47, .38, .18), mats["coat"], head_rig)
        cube(f"{character_id}_CapPeak", (0, .39, 2.2), (.31, .2, .035), mats["coat"], head_rig, bevel=.035)
    elif headwear == "glasses":
        for side in (-1, 1):
            torus(f"{character_id}_Lens_{side}", (side * .15, .41, 1.99), .12, .018, MATS["brass"], head_rig,
                  rotation=(math.radians(90), 0, 0))
        cube(f"{character_id}_GlassesBridge", (0, .425, 1.99), (.05, .02, .012), MATS["brass"], head_rig)
    elif headwear == "beanie":
        sphere(f"{character_id}_Beanie", (0, -.02, 2.28), (.46, .37, .22), mats["coat"], head_rig)
        torus(f"{character_id}_BeanieBand", (0, -.01, 2.17), .41, .045, mats["coat"], head_rig)
    elif headwear == "patch":
        cube(f"{character_id}_Patch", (.15, .41, 1.99), (.13, .025, .08), MATS["black"], head_rig, bevel=.018)
        cube(f"{character_id}_PatchStrap", (0, .395, 2.08), (.42, .012, .016), MATS["black"], head_rig,
             rotation=(0, math.radians(2), math.radians(9)), bevel=.008)
    elif headwear == "bandage":
        for offset in (-.08, .02, .12):
            torus(f"{character_id}_Bandage_{offset}", (0, .0, 2.02 + offset), .4, .035, MATS["paper"], head_rig,
                  rotation=(0, 0, math.radians(4 + offset * 22)))
    elif headwear == "hood":
        torus(f"{character_id}_Hood", (0, -.05, 1.98), .5, .13, mats["coat"], head_rig,
              rotation=(0, 0, 0), major_segments=32)


def build_shotgun() -> None:
    root = empty("Shotgun")
    root["asset_kind"] = "shotgun"
    barrel_rig = empty("Shotgun_BarrelRig", root, role="barrelAssembly")
    cylinder("Shotgun_Barrel", (1.58, 0, .16), .17, 3.75, MATS["gunmetal"], barrel_rig,
             rotation=(0, math.radians(90), 0), vertices=32)
    cylinder("Shotgun_MagTube", (1.28, 0, -.18), .125, 3.1, MATS["black"], barrel_rig,
             rotation=(0, math.radians(90), 0), vertices=28)
    torus("Shotgun_Muzzle", (3.46, 0, .16), .175, .035, MATS["worn_steel"], barrel_rig,
          rotation=(0, math.radians(90), 0), major_segments=32)
    cylinder("Shotgun_Bore", (3.47, 0, .16), .13, .025, MATS["black"], barrel_rig,
             rotation=(0, math.radians(90), 0), vertices=28)
    cube("Shotgun_Rib", (1.55, 0, .36), (1.75, .045, .025), MATS["worn_steel"], barrel_rig, bevel=.014)
    sphere("Shotgun_FrontSight", (3.22, 0, .43), (.055, .055, .055), MATS["brass"], barrel_rig, segments=16, rings=10)
    for x in (.5, 2.55):
        cube(f"Shotgun_Clamp_{x}", (x, 0, -.01), (.055, .23, .28), MATS["worn_steel"], barrel_rig, bevel=.028)

    receiver = cube("Shotgun_Receiver", (-.72, 0, .02), (.72, .34, .42), MATS["worn_steel"], root, bevel=.085)
    receiver["lc_role"] = "receiver"
    cube("Shotgun_ReceiverTop", (-.66, 0, .47), (.62, .25, .055), MATS["gunmetal"], root, bevel=.018)
    cube("Shotgun_EjectionPort", (-.45, -.355, .12), (.29, .018, .15), MATS["black"], root, bevel=.012)
    for x in (-1.15, -.7, -.25):
        cylinder(f"Shotgun_Pin_{x}", (x, -.37, .05), .035, .025, MATS["black"], root,
                 rotation=(math.radians(90), 0, 0), vertices=16)
    pump = empty("Shotgun_PumpRig", root, role="pump")
    pump.location = (.48, 0, -.17)
    cylinder("Shotgun_Pump", (0, 0, 0), .3, 1.06, MATS["dark_wood"], pump,
             rotation=(0, math.radians(90), 0), vertices=28)
    for x in (-.43, -.25, -.08, .08, .25, .43):
        torus(f"Shotgun_PumpRib_{x}", (x, 0, 0), .31, .018, MATS["wood"], pump,
              rotation=(0, math.radians(90), 0), major_segments=22)
    bolt = empty("Shotgun_BoltRig", root, role="bolt")
    cube("Shotgun_Bolt", (-.49, -.375, .12), (.2, .018, .09), MATS["silver"], bolt, bevel=.012)
    carrier = cube("Shotgun_Carrier", (-.65, 0, -.44), (.26, .13, .018), MATS["brass"], root, bevel=.012, role="carrier")
    cube("Shotgun_Stock", (-2.12, 0, .05), (.75, .38, .43), MATS["wood"], root,
         rotation=(0, math.radians(-7), 0), bevel=.13)
    cube("Shotgun_Butt", (-2.9, 0, -.01), (.1, .43, .52), MATS["black"], root, bevel=.055)
    capsule("Shotgun_Grip", (-1.45, 0, -.47), .22, .55, MATS["dark_wood"], root,
            rotation=(0, math.radians(-24), 0))
    torus("Shotgun_TriggerGuard", (-1.18, 0, -.4), .25, .038, MATS["gunmetal"], root,
          rotation=(math.radians(90), 0, 0), major_segments=24)
    cube("Shotgun_Trigger", (-1.04, 0, -.39), (.025, .045, .18), MATS["brass"], root,
         rotation=(0, math.radians(-16), 0), bevel=.01)
    for x in (-2.42, -2.12, -1.82):
        cube(f"Shotgun_StockInlay_{x}", (x, -.39, .05), (.018, .012, .28), MATS["brass"], root,
             rotation=(0, math.radians(-14), 0), bevel=.006)
    muzzle = empty("Shotgun_MuzzleMarker", barrel_rig, role="muzzle")
    muzzle.location = (3.56, 0, .16)
    left_grip = empty("Shotgun_LeftGrip", root, role="leftGrip")
    left_grip.location = (.48, 0, -.2)
    right_grip = empty("Shotgun_RightGrip", root, role="rightGrip")
    right_grip.location = (-1.48, 0, -.5)


def item_root(item_type: str):
    root = empty(f"Item_{item_type}")
    root["asset_kind"] = "item"
    root["item_type"] = item_type
    return root


def build_items() -> None:
    root = item_root("magnifier")
    torus("Magnifier_Rim", (0, 0, .18), .27, .045, MATS["silver"], root)
    cylinder("Magnifier_Lens", (0, 0, .18), .235, .018, MATS["glass"], root, vertices=32)
    capsule("Magnifier_Handle", (.36, 0, -.12), .05, .48, MATS["dark_wood"], root, rotation=(0, math.radians(45), 0))

    root = item_root("beer")
    cylinder("AbyssBottle_Body", (0, 0, .35), .2, .7, MATS["glass"], root, vertices=32)
    cylinder("AbyssBottle_Liquid", (0, 0, .3), .17, .56, MATS["liquid"], root, vertices=28)
    cylinder("AbyssBottle_Neck", (0, 0, .82), .1, .3, MATS["glass"], root, vertices=28)
    torus("AbyssBottle_Seal", (0, 0, .62), .2, .025, MATS["brass"], root)
    cylinder("AbyssBottle_Cork", (0, 0, 1.0), .095, .1, MATS["dark_wood"], root, vertices=20)
    for side in (-1, 1):
        cone(f"AbyssBottle_Fin_{side}", (side * .18, 0, .35), .07, .01, .34, MATS["bone"], root,
             rotation=(0, side * math.radians(62), 0))

    root = item_root("cigarettes")
    cube("CigaretteCase", (0, 0, .16), (.32, .11, .42), MATS["black"], root, bevel=.055)
    cube("CigaretteCase_Inlay", (0, -.12, .16), (.23, .012, .31), MATS["brass"], root, bevel=.025)
    for x in (-.15, -.05, .05, .15):
        cylinder(f"Cigarette_{x}", (x, 0, .68), .03, .5, MATS["paper"], root, vertices=14)
        cylinder(f"CigaretteEmber_{x}", (x, 0, .94), .032, .04, MATS["shell_red"], root, vertices=14)

    root = item_root("handcuffs")
    for side in (-1, 1):
        torus(f"Cuff_{side}", (side * .28, 0, .18), .22, .038, MATS["silver"], root)
    for x in (-.12, 0, .12):
        torus(f"CuffChain_{x}", (x, 0, .18), .065, .015, MATS["silver"], root,
              rotation=(0, math.radians(90 if x else 0), 0), major_segments=18)

    root = item_root("handsaw")
    blade = cube("Saw_Blade", (.16, 0, .2), (.58, .035, .16), MATS["silver"], root, bevel=.018)
    blade.rotation_euler.y = math.radians(-5)
    for tooth in range(12):
        cone(f"Saw_Tooth_{tooth}", (-.34 + tooth * .09, 0, .015), .035, .005, .12, MATS["silver"], root,
             rotation=(0, 0, math.pi))
    cube("Saw_Handle", (-.56, 0, .2), (.22, .13, .25), MATS["dark_wood"], root, bevel=.085)
    torus("Saw_HandleHole", (-.56, -.14, .2), .09, .025, MATS["brass"], root, rotation=(math.radians(90), 0, 0))

    root = item_root("phone")
    cube("Phone_Body", (0, 0, .18), (.29, .08, .47), MATS["black"], root, bevel=.085)
    cube("Phone_Screen", (0, -.085, .2), (.22, .012, .34), MATS["screen"], root, bevel=.035)
    torus("Phone_Speaker", (0, -.1, .53), .055, .012, MATS["brass"], root, rotation=(math.radians(90), 0, 0))
    for index, x in enumerate((-.14, 0, .14)):
        sphere(f"Phone_Eye_{index}", (x, -.1, -.18), (.035, .018, .035), MATS["liquid"], root, segments=14, rings=10)

    root = item_root("inverter")
    cylinder("Inverter_Core", (0, 0, .18), .14, .78, MATS["shell_red"], root, rotation=(0, math.radians(90), 0), vertices=24)
    torus("Inverter_Coil", (0, 0, .18), .26, .035, MATS["silver"], root, rotation=(0, math.radians(90), 0))
    for x in (-.3, -.15, 0, .15, .3):
        torus(f"Inverter_Rib_{x}", (x, 0, .18), .15, .012, MATS["black"], root, rotation=(0, math.radians(90), 0))
    sphere("Inverter_Charge", (.48, 0, .18), (.12, .12, .12), MATS["screen"], root, segments=18, rings=12)

    root = item_root("adrenaline")
    cylinder("Syringe_Tube", (0, 0, .18), .07, .72, MATS["glass"], root, rotation=(0, math.radians(90), 0), vertices=24)
    cylinder("Syringe_Blood", (-.05, 0, .18), .052, .5, MATS["blood"], root, rotation=(0, math.radians(90), 0), vertices=20)
    cylinder("Syringe_Plunger", (-.45, 0, .18), .1, .08, MATS["silver"], root, rotation=(0, math.radians(90), 0), vertices=18)
    cylinder("Syringe_Needle", (.58, 0, .18), .012, .38, MATS["silver"], root, rotation=(0, math.radians(90), 0), vertices=12)

    root = item_root("medicine")
    cylinder("Medicine_Jar", (0, 0, .3), .24, .58, MATS["glass"], root, vertices=28)
    cylinder("Medicine_Label", (0, 0, .31), .245, .28, MATS["paper"], root, vertices=28)
    cylinder("Medicine_Cap", (0, 0, .66), .2, .16, MATS["shell_red"], root, vertices=24)
    for index in range(5):
        sphere(f"Medicine_Pill_{index}", ((index - 2) * .065, -.15 + (index % 2) * .05, .19 + (index % 3) * .08),
               (.055, .035, .08), MATS["bone"], root, segments=14, rings=10)


def nearest_asset_owner(obj: bpy.types.Object) -> bpy.types.Object | None:
    """Return the nearest animation role or top-level asset root."""
    cursor = obj.parent
    while cursor:
        if cursor.get("lc_role") or cursor.get("asset_kind"):
            return cursor
        cursor = cursor.parent
    return None


def consolidate_meshes() -> None:
    """Collapse decorative parts into one mesh per movable role/root.

    The source .blend keeps named role empties for hands, head, pump, barrel and
    other runtime controls while the GLB avoids hundreds of individual draws.
    """
    groups: dict[bpy.types.Object, list[bpy.types.Object]] = {}
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        owner = nearest_asset_owner(obj)
        if owner:
            groups.setdefault(owner, []).append(obj)
    for owner, meshes in groups.items():
        if not meshes:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for mesh in meshes:
            mesh.select_set(True)
            bpy.context.view_layer.objects.active = mesh
            for modifier in list(mesh.modifiers):
                try:
                    bpy.ops.object.modifier_apply(modifier=modifier.name)
                except RuntimeError:
                    pass
        valid_meshes = [mesh for mesh in meshes if mesh.name in bpy.data.objects]
        bpy.ops.object.select_all(action="DESELECT")
        for mesh in valid_meshes:
            mesh.select_set(True)
        active = valid_meshes[0]
        bpy.context.view_layer.objects.active = active
        bpy.ops.object.join()
        active.name = f"{owner.name}_Mesh"
        active.parent = owner
        active.matrix_parent_inverse = owner.matrix_world.inverted()
    changed = True
    while changed:
        changed = False
        for obj in list(bpy.data.objects):
            if obj.type == "EMPTY" and not obj.children and not obj.get("lc_role") and not obj.get("asset_kind"):
                bpy.data.objects.remove(obj, do_unlink=True)
                changed = True


def finalize_and_export() -> dict:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.world.color = (.008, .012, .011)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUTPUT))
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_yup=True,
    )
    return {
        "glb": str(OUTPUT),
        "blend": str(BLEND_OUTPUT),
        "objects": len(bpy.data.objects),
        "meshes": len(bpy.data.meshes),
        "materials": len(bpy.data.materials),
        "glb_bytes": OUTPUT.stat().st_size,
    }


def build() -> dict:
    reset_scene()
    make_materials()
    for index, character_id in enumerate(CHARACTERS):
        build_character(character_id, index)
    build_shotgun()
    build_items()
    consolidate_meshes()
    return finalize_and_export()


result = build()
