import { Vec3, PassType } from '../libs/zea-engine/dist/index.esm.js'
import { PointCloudAsset, GLPointCloudPass } from '../libs/zea-pointclouds/dist/index.rawimport.js'

const loadPointCloud = (appData) => {
  const pointcloudPass = new GLPointCloudPass()
  appData.renderer.addPass(pointcloudPass, PassType.OPAQUE)

  const pointcloud = new PointCloudAsset('NavVisHQ')
  const pointCloudUrl = 'https://storage.googleapis.com/zea-projects-assets/5764748591235072/NavVisHQ/cloud.js'
  pointcloud.getParameter('Point Size').setValue(0.5)
  pointcloud.getParameter('Point Size Attenuation').setValue(0.5)
  pointcloud.loadPointCloud(pointCloudUrl, 'PointCloud').then((e) => {
    const xfoParam = pointcloud.getParameter('GlobalXfo')
    const xfo = xfoParam.getValue()
    console.log(xfo.toString())
    xfo.tr.addInPlace(new Vec3(15, 15, 0))
    xfoParam.setValue(xfo)
  })

  return pointcloud
}
export default loadPointCloud
