import {
  Vec3,
  Quat,
  Xfo,
  Color,
  NumberParameter,
  Material,
  Cuboid,
  GeomItem,
} from '../libs/zea-engine/dist/index.esm.js'
import {
  XfoTrack,
  TrackSampler,
  XfoTrackDisplay,
  AttachmentConstraint,
} from '../libs/zea-kinematics/dist/index.rawimport.js'

const setupAnimation = (treeItem) => {
  const timeParam = new NumberParameter('time', 0)
  treeItem.addParameter(timeParam)

  const target = treeItem.getChildByName('target')
  const asset = treeItem.getChildByName('MC700_ASSY')

  const makePlate = () => {
    const plateMaterial = new Material('plateMaterial', 'SimpleSurfaceShader')
    plateMaterial.getParameter('BaseColor').setValue(new Color(0, 0, 1))
    const plateItem = new GeomItem('plate', new Cuboid(1.0, 2.0, 0.02), plateMaterial)
    treeItem.addChild(plateItem)
    const xfo = new Xfo()
    xfo.tr.set(2.86, -1.0, 0.5)
    xfo.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), Math.PI * 0.5)
    plateItem.getParameter('GlobalXfo').setValue(xfo)
    return plateItem
  }
  const plateItem = makePlate()

  const makeStamper = () => {
    const stamperMaterial = new Material('stamperMaterial', 'SimpleSurfaceShader')
    stamperMaterial.getParameter('BaseColor').setValue(new Color(0, 1, 1))
    const stamperItem = new GeomItem('stamper', new Cuboid(1.0, 2.0, 0.5, true), stamperMaterial)
    treeItem.addChild(stamperItem)

    const xfo = new Xfo()
    xfo.tr.set(0.0, 2.5, 0.0)
    xfo.ori.setFromAxisAndAngle(new Vec3(0, 0, 1), Math.PI * 0.5)
    stamperItem.getParameter('GlobalXfo').setValue(xfo)
    return stamperItem
  }
  const stamperItem = makeStamper()

  asset.on('loaded', () => {
    const xfoTrack = new XfoTrack('XfoTrack')

    const align = new Quat()
    const xfo0 = target.getParameter('GlobalXfo').getValue().clone()

    // xfoTrack.addKey(0, xfo0)
    // xfoTrack.addKey(1000, xfo0)

    const xfo2 = xfo0.clone()
    xfo2.tr.z -= 0.1
    xfo2.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), 1.0)
    xfoTrack.addKey(1000, xfo2)
    // xfoTrack.addKey(1200, xfo2)

    const xfo3 = xfo2.clone()
    xfo3.tr.set(2.0, -0.5, 2.2)
    // xfo3.ori.setFromAxisAndAngle(new Vec3(0, 0, 1), 0.75)
    xfoTrack.addKey(1600, xfo3)

    // Reach down
    const xfo4 = xfo3.clone()
    xfo4.tr.set(2.85, -1.0, 0.4)
    xfo4.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), Math.PI * 0.0)
    xfoTrack.addKey(2400, xfo4)
    xfoTrack.addKey(2800, xfo4)

    // Lift
    const xfo5 = xfo4.clone()
    xfo5.tr.set(1.5, -1.0, 1.8)
    xfo5.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), Math.PI * 0.25)
    xfoTrack.addKey(3200, xfo5)
    // xfoTrack.addKey(3600, xfo5)

    // Turn to place
    const xfo6 = xfo5.clone()
    xfo6.tr.set(0.0, 1.5, 1.8)
    xfo6.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), Math.PI * 0.5)
    // align.setFromAxisAndAngle(new Vec3(0, 0, 1), Math.PI * -0.5)
    align.setFromAxisAndAngle(new Vec3(0, 0, 1), Math.PI * 0.5)
    xfo6.ori = align.multiply(xfo6.ori)
    xfoTrack.addKey(4400, xfo6)

    const xfo7 = xfo6.clone()
    xfo7.tr.set(0.0, 2.5, 1.2)
    // xfo7.ori.setFromAxisAndAngle(new Vec3(0, 1, 0), Math.PI * 0.5)
    // align.setFromAxisAndAngle(new Vec3(0, 0, 1), Math.PI * 0.5)
    // xfo7.ori = align.multiply(xfo7.ori)
    // xfo7.ori.alignWith(xfo6.ori)
    // xfo7.ori = align.multiply(xfo7.ori)
    xfoTrack.addKey(4800, xfo7)

    const xfo8 = xfo7.clone()
    xfo8.tr.set(0.0, 2.5, 0.6)
    xfo8.ori.setFromAxisAndAngle(new Vec3(0, 0, 1), Math.PI * 0.5)
    align.setFromAxisAndAngle(new Vec3(1, 0, 0), Math.PI * -0.5)
    xfo8.ori = align.multiply(xfo8.ori)
    xfoTrack.addKey(5200, xfo8)
    xfoTrack.addKey(5600, xfo8)

    // Step Back and wait
    const xfo9 = xfo8.clone()
    xfo9.tr.set(0.0, 1.5, 1.6)
    xfoTrack.addKey(6000, xfo9)
    xfoTrack.addKey(6400, xfo9)

    // Go back to key 2
    xfoTrack.addKey(7000, xfo2)

    const xfoTrackSampler = new TrackSampler('XfoTrack', xfoTrack)
    xfoTrackSampler.getInput('Time').setParam(timeParam)
    xfoTrackSampler.getOutput('Output').setParam(target.getParameter('GlobalXfo'))

    const TrackDisplay = new XfoTrackDisplay(xfoTrack)
    treeItem.addChild(TrackDisplay)

    /////////////////////////////////////////////////
    // Robot Head

    const robotHead = asset.getChildByName('NAUO15')
    const sttachmentConstraint = new AttachmentConstraint('PlateAttach')
    sttachmentConstraint.getInput('Time').setParam(timeParam)
    sttachmentConstraint.getOutput('Attached').setParam(plateItem.getParameter('GlobalXfo'))
    sttachmentConstraint.addAttachTarget(robotHead.getParameter('GlobalXfo'), 2800)
    sttachmentConstraint.addAttachTarget(stamperItem.getParameter('GlobalXfo'), 5200)

    let time = 0
    setInterval(() => {
      time += 20
      timeParam.setValue(time)

      if (time > 7000) time = 0
    }, 20)
  })
}

export default setupAnimation
