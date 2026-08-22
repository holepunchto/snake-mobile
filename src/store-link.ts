import { Linking, Platform } from 'react-native'
import appJson from '../app.json'

const androidPackage = appJson.expo.android.package
const iosAppStoreId = appJson.expo.extra.iosAppStoreId

export const storeName = Platform.OS === 'ios' ? 'App Store' : 'Play Store'

const links =
  Platform.OS === 'ios'
    ? iosAppStoreId
      ? [
          `itms-apps://apps.apple.com/app/id${iosAppStoreId}`,
          `https://apps.apple.com/app/id${iosAppStoreId}`
        ]
      : []
    : [
        `market://details?id=${androidPackage}`,
        `https://play.google.com/store/apps/details?id=${androidPackage}`
      ]

export const canOpenStore = links.length > 0

export async function openStore() {
  for (const url of links) {
    try {
      await Linking.openURL(url)
      return
    } catch {
      continue
    }
  }
  console.error(`could not open the ${storeName}`)
}
