import { Vec3, Color, Scene, GLRenderer } from '../libs/zea-engine/dist/index.esm.js'

const domElement = document.getElementById('viewport')

const scene = new Scene()
scene.setupGrid(10.0, 10)

const renderer = new GLRenderer(domElement, {
  webglOptions: {},
})
renderer.setScene(scene)

const appData = {
  scene,
  renderer,
}

renderer
  .getViewport()
  .getCamera()
  .setPositionAndTarget(new Vec3({ x: 5.0, y: 5.0, z: 2.0 }), new Vec3({ x: 0.0, y: 0.0, z: 1 }))

////////////////////////////////////
// Load the Model
import loadModel from './2.loadModel.js'
const treeItem = loadModel(appData)
scene.getRoot().addChild(treeItem)

////////////////////////////////////
// Point Cloud renderer
import loadPointCloud from './1.loadPointCloud.js'
const pointCloud = loadPointCloud(appData)
scene.getRoot().addChild(pointCloud)

////////////////////////////////////
// Setup the Left side Tree view.

import {
  SelectionManager,
  ToolManager,
  ViewTool,
  HandleTool,
  SelectionTool,
  UndoRedoManager,
} from '../libs/zea-ux/dist/index.rawimport.js'

appData.selectionManager = new SelectionManager(appData, {
  enableXfoHandles: true,
})
appData.selectionManager.on('selectionChanged', (event) => {
  event.selection.forEach((item) => console.log(item.getPath()))
})
appData.undoRedoManager = new UndoRedoManager()
appData.toolManager = new ToolManager(appData)

renderer.setUndoRedoManager(appData.undoRedoManager)
////////////////////////////////////////////////////
// Setup the tools.

renderer.getViewport().setManipulator(null)
appData.toolManager.bind(renderer)

// Connect the selection manager to the renderer
// so it can display transform handles.
appData.selectionManager.setRenderer(renderer)

//////////////////////////////////////////////////////
// Tools
const viewTool = new ViewTool(appData)
const handleTool = new HandleTool(appData)
const selectionTool = new SelectionTool(appData)
appData.toolManager.pushTool(viewTool)
appData.toolManager.pushTool(handleTool)

// // Note: the alpha value determines  the fill of the highlight.
const selectionColor = new Color('#00436D')
selectionColor.a = 0.1
const subtreeColor = selectionColor.lerp(new Color(1, 1, 1, 0), 0.5)
appData.selectionManager.selectionGroup.getParameter('HighlightColor').setValue(selectionColor)
appData.selectionManager.selectionGroup.getParameter('SubtreeHighlightColor').setValue(subtreeColor)

// const sceneTreeView = document.getElementById("zea-tree-view");
// sceneTreeView.appData = appData;
// sceneTreeView.rootItem = scene.getRoot();

let selectItemsActivatedTime
let selectItemsActivated = false
let currKey
document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() == currKey) return
  switch (event.key.toLowerCase()) {
    case 'f': {
      renderer.frameAll()
      break
    }
    case 's': {
      if (selectItemsActivated) {
        appData.toolManager.popTool()
        selectItemsActivated = false
      } else {
        appData.toolManager.pushTool(selectionTool)
        selectItemsActivated = true
        selectItemsActivatedTime = performance.now()
      }
      break
    }
    case 'w': {
      appData.selectionManager.showHandles('Translate')
      break
    }
    case 'e': {
      appData.selectionManager.showHandles('Rotate')
      break
    }
    case 'z': {
      if (event.ctrlKey) appData.undoRedoManager.undo()
      break
    }
    case 'y': {
      if (event.ctrlKey) appData.undoRedoManager.undo()
      break
    }
  }
  currKey = event.key.toLowerCase()
})

document.addEventListener('keyup', (event) => {
  switch (event.key.toLowerCase()) {
    case 'f': {
      renderer.frameAll()
      break
    }
    case 's': {
      if (selectItemsActivated) {
        const t = performance.now() - selectItemsActivatedTime
        if (t > 400) {
          appData.toolManager.popTool()
          selectItemsActivated = false
        }
      }
    }
  }
  if (event.key.toLowerCase() == currKey) currKey = undefined
})

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
import './zea-fps-display.js'
const fpsDisplay = document.createElement('zea-fps-display')
fpsDisplay.renderer = renderer
domElement.appendChild(fpsDisplay)
