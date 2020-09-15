const { Vec3, Color, Group, EnvMap, Scene, GLRenderer } = globalThis.zeaEngine

const domElement = document.getElementById('viewport')

const scene = new Scene()
scene.setupGrid(10.0, 10)

const renderer = new GLRenderer(domElement, {
  webglOptions: {
    antialias: true,
    canvasPosition: 'relative',
  },
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

const envMap = new EnvMap('envMap')
envMap.getParameter('FilePath').setUrl('./data/HDR_029_Sky_Cloudy_Ref.vlenv')
scene.setEnvMap(envMap)

const urlParams = new URLSearchParams(window.location.search)

////////////////////////////////////
// Load the Model
import loadModel from './2.loadModel.js'
const treeItem = loadModel(appData)
scene.getRoot().addChild(treeItem)

////////////////////////////////////
// Point Cloud renderer
import loadPointCloud from './1.loadPointCloud.js'
if (!urlParams.has('nopoints')) {
  const pointCloud = loadPointCloud(appData)
  scene.getRoot().addChild(pointCloud)
}

////////////////////////////////////
// Setup Animation

import setupAnimation from './3.setupAnimation.js'
if (!urlParams.has('noanim')) {
  setupAnimation(treeItem)
}

////////////////////////////////////
// Setup the Left side Tree view.

const { SelectionManager, ToolManager, ViewTool, HandleTool, SelectionTool, UndoRedoManager } = globalThis.zeaUx

appData.selectionManager = new SelectionManager(appData, {
  enableXfoHandles: true,
})

appData.selectionManager.on('selectionChanged', (event) => {
  event.selection.forEach((item) => console.log(item.getPath()))
})

appData.undoRedoManager = UndoRedoManager.getInstance()
appData.toolManager = new ToolManager(appData)

renderer.setUndoRedoManager(appData.undoRedoManager)

const target = treeItem.getChildByName('target')
appData.selectionManager.setSelection(new Set([target]), false)

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

let selectItemsActivatedTime
let selectItemsActivated = false
let currKey

window.frameSelection = () => {
  renderer.frameAll()
}

window.undoChange = () => {
  appData.undoRedoManager.undo()
}

window.redoChange = () => {
  appData.undoRedoManager.redo()
}

window.setMoveMode = () => {
  if (selectItemsActivated) setToolModeToTransform()
  appData.selectionManager.showHandles('Translate')
  // document.getElementById('select-move-mode').setAttribute('checked', 'true')
  // document.getElementById('select-rotate-mode').setAttribute('checked', 'false')
}

window.setRotateMode = () => {
  if (selectItemsActivated) setToolModeToTransform()
  appData.selectionManager.showHandles('Rotate')
  // document.getElementById('select-move-mode').setAttribute('checked', 'false')
  // document.getElementById('select-rotate-mode').setAttribute('checked', 'true')
}

window.setGlobalTransformMode = () => {
  appData.selectionManager.setXfoMode(Group.INITIAL_XFO_MODES.globalOri)
}

window.setLocalTransformMode = () => {
  appData.selectionManager.setXfoMode(Group.INITIAL_XFO_MODES.average)
}

window.setToolModeToTransform = () => {
  if (selectItemsActivated) {
    appData.toolManager.popTool()
    selectItemsActivated = false
  }
}

window.setToolModeToSelect = () => {
  if (selectItemsActivated) {
    setToolModeToTransform()
  } else {
    appData.toolManager.pushTool(selectionTool)
    selectItemsActivated = true
    selectItemsActivatedTime = performance.now()
  }
}

window.launchVR = () => {}

////////////////////////////////////
// Setup UI Web Components

const sceneTreeView = document.getElementById('zea-tree-view')
sceneTreeView.appData = appData
sceneTreeView.rootItem = scene.getRoot()

////////////////////////////////////
// Setup Collaboration
/*
import { Session, SessionSync } from '../libs/zea-collab/dist/index.rawimport.js'

const firstNames = ['Phil', 'Froilan', 'Alvaro', 'Dan', 'Mike', 'Rob', 'Steve']
const lastNames = ['Taylor', 'Smith', 'Haines', 'Moore', 'Elías Pájaro Torreglosa', 'Moreno']
const userData = {
  given_name: firstNames[MathFunctions.randomInt(0, firstNames.length)],
  family_name: lastNames[MathFunctions.randomInt(0, lastNames.length)],
  id: Math.random().toString(36).slice(2, 12),
  color: Color.random().toHex(),
}

const socketUrl = 'https://websocket-staging.zea.live'
const session = new Session(userData, socketUrl)
let roomId = urlParams.get('room-id')
session.joinRoom(document.location.href + roomId)

const sessionSync = new SessionSync(session, appData, userData, {})

const userChipSet = document.getElementById('zea-user-chip-set')
userChipSet.session = session
userChipSet.showImages = true //boolean('Show Images', true)

document.addEventListener(
  'zeaUserClicked',
  () => {
    console.log('user clicked')
  },
  false
)

const userChip = document.getElementById('zea-user-chip')
userChip.userData = userData
*/
////////////////////////////////////
// Display the Fps
import './zea-fps-display.js'
const fpsDisplay = document.createElement('zea-fps-display')
fpsDisplay.renderer = renderer
domElement.appendChild(fpsDisplay)
