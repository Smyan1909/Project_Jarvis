// Fix for pnpm hoisted mode - manually configure community modules
module.exports = {
  dependencies: {
    'react-native-gesture-handler': {
      root: '../../node_modules/react-native-gesture-handler',
      platforms: {
        android: {
          sourceDir: '../../node_modules/react-native-gesture-handler/android',
          packageImportPath: 'import com.swmansion.gesturehandler.RNGestureHandlerPackage;',
          packageInstance: 'new RNGestureHandlerPackage()',
        },
        ios: null,
      },
    },
    'react-native-reanimated': {
      root: '../../node_modules/react-native-reanimated',
      platforms: {
        android: {
          sourceDir: '../../node_modules/react-native-reanimated/android',
          packageImportPath: 'import com.swmansion.reanimated.ReanimatedPackage;',
          packageInstance: 'new ReanimatedPackage()',
        },
        ios: null,
      },
    },
    'react-native-screens': {
      root: '../../node_modules/react-native-screens',
      platforms: {
        android: {
          sourceDir: '../../node_modules/react-native-screens/android',
          packageImportPath: 'import com.swmansion.rnscreens.RNScreensPackage;',
          packageInstance: 'new RNScreensPackage()',
        },
        ios: null,
      },
    },
    'react-native-safe-area-context': {
      root: '../../node_modules/react-native-safe-area-context',
      platforms: {
        android: {
          sourceDir: '../../node_modules/react-native-safe-area-context/android',
          packageImportPath: 'import com.th3rdwave.safeareacontext.SafeAreaContextPackage;',
          packageInstance: 'new SafeAreaContextPackage()',
        },
        ios: null,
      },
    },
    'react-native-get-random-values': {
      root: '../../node_modules/react-native-get-random-values',
      platforms: {
        android: {
          sourceDir: '../../node_modules/react-native-get-random-values/android',
          packageImportPath: 'import org.linusu.RNGetRandomValuesPackage;',
          packageInstance: 'new RNGetRandomValuesPackage()',
        },
        ios: null,
      },
    },
  },
};
