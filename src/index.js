import {
  Vec3,
  Quat,
  Xfo,
  Ray,
  Color,
  Scene,
  Group,
  Material,
  TreeItem,
  GeomItem,
  Cuboid,
  PassType,
  GLRenderer,
} from "../libs/zea-engine/dist/index.esm.js";
import { GLCADPass, CADAsset } from "../libs/zea-cad/dist/index.rawimport.js";

const domElement = document.getElementById("viewport");

const scene = new Scene();
scene.setupGrid(10.0, 10);

const renderer = new GLRenderer(domElement, {
  webglOptions: {},
});

const appData = {
  scene,
  renderer,
};

const cadPass = new GLCADPass(true);
cadPass.setShaderPreprocessorValue("#define ENABLE_PBR");
renderer.addPass(cadPass, PassType.OPAQUE);

renderer.setScene(scene);
renderer.resumeDrawing();

////////////////////////////////////
// // Load the Robot Model
const asset = new CADAsset();
asset.getParameter("DataFilePath").setUrl("data/MC700_ASSY.zcad");

scene.getRoot().addChild(asset);

////////////////////////////////////
// Load the Kinematics
import { IKSolver } from "../libs/zea-kinematics/dist/index.rawimport.js";

// ///////////////////////////////////////
// Setup the Solver
const treeItem = new TreeItem("tree");
const ikSolver = new IKSolver("ikSolver");
treeItem.addChild(ikSolver);

///////////////////////////////////////
// Setup the joints

scene.getRoot().addChild(treeItem);
function addJoint(name, axis) {
  // const joint = asset.getChildByName(name);
  const joint = new Group(name);
  joint.addItem(asset.getChildByName(name));
  ikSolver.addJoint(joint.getParameter("GlobalXfo"), axis);
  return joint;
}

asset.on("loaded", () => {
  // const joint = new Group(name);
  // ikSolver.getInput("Target").setParam(targGeomItem.getParameter("GlobalXfo"));

  addJoint("NAUO1", 2);
  addJoint("NAUO6", 1);
  addJoint("NAUO16", 1);
  addJoint("NAUO7", 0);
  addJoint("NAUO17", 1);
  addJoint("NAUO15", 0);

  /////////////////////////////////////////
  // Setup the Target
  const targGeom = new Cuboid(0.05, 0.1, 0.1);
  const targGeomMaterial = new Material(
    "targGeommaterial",
    "SimpleSurfaceShader"
  );
  targGeomMaterial.getParameter("BaseColor").setValue(new Color(0, 0.5, 0));
  const targGeomItem = new GeomItem("target", targGeom, targGeomMaterial);
  const targXfo = asset
    .getChildByName("NAUO15")
    .getParameter("GlobalXfo")
    .getValue()
    .clone();
  targXfo.sc.set(1, 1, 1);
  // targXfo.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), Math.PI * 0.5);
  targGeomItem.getParameter("GlobalXfo").setValue(targXfo);
  treeItem.addChild(targGeomItem);

  ikSolver.getInput("Target").setParam(targGeomItem.getParameter("GlobalXfo"));

  ikSolver.enable();

  appData.selectionManager.setSelection(new Set([targGeomItem]), false);

  // ///////////////////////////////////////
  // Make the target draggable.
  // targGeomItem.on("mouseEnter", (event) => {
  //   targGeomMaterial.getParameter("BaseColor").setValue(new Color(1, 1, 1));
  // });
  // targGeomItem.on("mouseLeave", (event) => {
  //   targGeomMaterial.getParameter("BaseColor").setValue(new Color(0, 1, 0));
  // });

  // let draggedGeom;
  // const geomRay = new Ray();
  // const mouseMove = (event) => {
  //   event.stopPropagation();

  //   const xfo = draggedGeom.getParameter("GlobalXfo").getValue();
  //   const dist = event.mouseRay.intersectRayPlane(geomRay);
  //   xfo.tr = event.mouseRay.pointAtDist(dist);
  //   draggedGeom.getParameter("GlobalXfo").setValue(xfo);
  // };
  // const mouseUp = (event) => {
  //   event.stopPropagation();

  //   renderer.getViewport().off("mouseMove", mouseMove);
  //   renderer.getViewport().off("mouseUp", mouseUp);
  // };
  // renderer.getViewport().on("mouseDownOnGeom", (event) => {
  //   if (event.intersectionData.geomItem == targGeomItem) {
  //     event.stopPropagation();
  //     draggedGeom = event.intersectionData.geomItem;

  //     // geomRay.dir = event.viewport.getCamera().getParameter('GlobalXfo').getValue().ori.getZaxis().negate()
  //     geomRay.dir = event.mouseRay.dir.negate();
  //     geomRay.start = draggedGeom.getParameter("GlobalXfo").getValue().tr;

  //     renderer.getViewport().on("mouseMove", mouseMove);
  //     renderer.getViewport().on("mouseUp", mouseUp);
  //   }
  // });
});

renderer
  .getViewport()
  .getCamera()
  .setPositionAndTarget(
    new Vec3({ x: 5.0, y: 5.0, z: 2.0 }),
    new Vec3({ x: 0.0, y: 0.0, z: 1 })
  );

////////////////////////////////////
// Point Cloud renderer
// import {
//   PointCloudAsset,
//   GLPointCloudPass,
// } from "../libs/zea-pointclouds/dist/index.rawimport.js";

// const pointcloudPass = new GLPointCloudPass();
// renderer.addPass(pointcloudPass, PassType.OPAQUE);

// const pointcloudAsset = new PointCloudAsset();
// const pointCloudUrl =
//   "https://storage.googleapis.com/zea-projects-assets/5764748591235072/NavVisHQ/cloud.js";
// pointcloudAsset.getParameter("Point Size").setValue(0.5);
// pointcloudAsset.getParameter("Point Size Attenuation").setValue(0.5);
// pointcloudAsset.loadPointCloud(pointCloudUrl, "PointCloud").then((e) => {
//   const xfoParam = pointcloudAsset.getParameter("GlobalXfo");
//   const xfo = xfoParam.getValue();
//   console.log(xfo.toString());
//   xfo.tr.addInPlace(new Vec3(15, 15, 0));
//   xfoParam.setValue(xfo);
// });
// scene.getRoot().addChild(pointcloudAsset);

////////////////////////////////////
// Setup the Left side Tree view.

import {
  SelectionManager,
  ToolManager,
  ViewTool,
  HandleTool,
  SelectionTool,
} from "../libs/zea-ux/dist/index.rawimport.js";

appData.selectionManager = new SelectionManager(appData, {
  enableXfoHandles: true,
});
appData.toolManager = new ToolManager(appData);

////////////////////////////////////////////////////
// Setup the tools.

renderer.getViewport().setManipulator(null);
appData.toolManager.bind(renderer);

// Connect the selection manager to the renderer
// so it can display transform handles.
appData.selectionManager.setRenderer(renderer);

//////////////////////////////////////////////////////
// Tools
const viewTool = new ViewTool(appData);
const handleTool = new HandleTool(appData);
const selectionTool = new SelectionTool(appData);
appData.toolManager.pushTool(viewTool);
appData.toolManager.pushTool(handleTool);

// // Note: the alpha value determines  the fill of the highlight.
const selectionColor = new Color("#00436D");
selectionColor.a = 0.1;
const subtreeColor = selectionColor.lerp(new Color(1, 1, 1, 0), 0.5);
appData.selectionManager.selectionGroup
  .getParameter("HighlightColor")
  .setValue(selectionColor);
appData.selectionManager.selectionGroup
  .getParameter("SubtreeHighlightColor")
  .setValue(subtreeColor);

// const sceneTreeView = document.getElementById("zea-tree-view");
// sceneTreeView.appData = appData;
// sceneTreeView.rootItem = scene.getRoot();

let selectItemsActivatedTime;
let selectItemsActivated = false;
let currKey;
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() == currKey) return;
  switch (event.key.toLowerCase()) {
    case "f": {
      renderer.frameAll();
      break;
    }
    case "s": {
      if (selectItemsActivated) {
        appData.toolManager.popTool();
        selectItemsActivated = false;
      } else {
        appData.toolManager.pushTool(selectionTool);
        selectItemsActivated = true;
        selectItemsActivatedTime = performance.now();
      }
      break;
    }
    case "w": {
      appData.selectionManager.showHandles("Translate");
      break;
    }
    case "e": {
      appData.selectionManager.showHandles("Rotate");
      break;
    }
  }
  currKey = event.key.toLowerCase();
});

document.addEventListener("keyup", (event) => {
  switch (event.key.toLowerCase()) {
    case "f": {
      renderer.frameAll();
      break;
    }
    case "s": {
      if (selectItemsActivated) {
        const t = performance.now() - selectItemsActivatedTime;
        if (t > 400) {
          appData.toolManager.popTool();
          selectItemsActivated = false;
        }
      }
    }
  }
  if (event.key.toLowerCase() == currKey) currKey = undefined;
});

////////////////////////////////////
// Setup Collaboration
// import { Session, SessionSync } from "../libs/zea-collab/dist/index.rawimport.js"

// const urlParams = new URLSearchParams(window.location.search);
// let userId = urlParams.get('user-id');
// if (!userId) {
//   userId = localStorage.getItem('userId');
//   if(!userId) {
//     userId = Math.random().toString(36).slice(2, 12);
//     localStorage.setItem('userId', userId);
//   }
// } else {
//   localStorage.setItem('userId', userId);
// }

// const color = Color.random();
// const firstNames = ["Phil", "Froilan", "Alvaro", "Dan", "Mike", "Rob", "Steve"]
// const lastNames = ["Taylor", "Smith", "Haines", "Moore", "Elías Pájaro Torreglosa", "Moreno"]
// const userData = {
//   given_name: firstNames[Math.randomInt(0, firstNames.length)],
//   family_name: lastNames[Math.randomInt(0, lastNames.length)],
//   id: userId,
//   color: color.toHex()
// }

// const socketUrl = 'https://websocket-staging.zea.live';
// const session = new Session(userData, socketUrl);
// let roomId = urlParams.get('room-id');
// session.joinRoom(document.location.href+roomId);

// const sessionSync = new SessionSync(session, appData, userData, {});

// const userChipSet = document.getElementById(
//   "zea-user-chip-set"
// );
// userChipSet.session = session
// userChipSet.showImages = true;//boolean('Show Images', true)

// document.addEventListener(
//   'zeaUserClicked',
//   () => {
//     console.log('user clicked')
//   },
//   false
// )

// const userChip = document.getElementById(
//   "zea-user-chip"
// );
// userChip.userData = userData

////////////////////////////////////
// Display the Fps
import "./zea-fps-display.js";
const fpsDisplay = document.createElement("zea-fps-display");
fpsDisplay.renderer = renderer;
domElement.appendChild(fpsDisplay);
