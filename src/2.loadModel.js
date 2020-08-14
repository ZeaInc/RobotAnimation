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
} from '../libs/zea-engine/dist/index.esm.js'
import { GLCADPass, CADAsset } from '../libs/zea-cad/dist/index.rawimport.js'
import { IKSolver } from '../libs/zea-kinematics/dist/index.rawimport.js'

const loadModel = (appData) => {
  const cadPass = new GLCADPass(true)
  cadPass.setShaderPreprocessorValue('#define ENABLE_PBR')
  appData.renderer.addPass(cadPass, PassType.OPAQUE)

  const treeItem = new TreeItem('tree')

  ////////////////////////////////////
  // // Load the Robot Model
  const asset = new CADAsset()
  asset.getParameter('DataFilePath').setUrl('data/MC700_ASSY.zcad')

  treeItem.addChild(asset)

  ////////////////////////////////////
  // Load the Kinematics

  // ///////////////////////////////////////
  // Setup the Solver
  const ikSolver = new IKSolver('ikSolver')
  treeItem.addChild(ikSolver)

  ///////////////////////////////////////
  // Setup the joints

  function addJoint(name, axis) {
    // const joint = asset.getChildByName(name);
    const joint = new Group(name)
    joint.addItem(asset.getChildByName(name))
    ikSolver.addJoint(joint.getParameter('GlobalXfo'), axis)
    return joint
  }

  asset.on('loaded', () => {
    // const joint = new Group(name);
    // ikSolver.getInput("Target").setParam(targGeomItem.getParameter("GlobalXfo"));

    addJoint('NAUO1', 2)
    addJoint('NAUO6', 1)
    addJoint('NAUO16', 1)
    addJoint('NAUO7', 0)
    addJoint('NAUO17', 1)
    addJoint('NAUO15', 0)

    /////////////////////////////////////////
    // Setup the Target
    const targGeom = new Cuboid(0.05, 0.1, 0.1)
    const targGeomMaterial = new Material('targGeommaterial', 'SimpleSurfaceShader')
    targGeomMaterial.getParameter('BaseColor').setValue(new Color(0, 0.5, 0))
    const targGeomItem = new GeomItem('target', targGeom, targGeomMaterial)
    const targXfo = asset.getChildByName('NAUO15').getParameter('GlobalXfo').getValue().clone()
    targXfo.sc.set(1, 1, 1)
    // targXfo.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), Math.PI * 0.5);
    targGeomItem.getParameter('GlobalXfo').setValue(targXfo)
    treeItem.addChild(targGeomItem)

    ikSolver.getInput('Target').setParam(targGeomItem.getParameter('GlobalXfo'))

    ikSolver.enable()

    appData.selectionManager.setSelection(new Set([targGeomItem]), false)
  })

  return treeItem
}

export default loadModel
