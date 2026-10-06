// SVG files are turned into React components by `react-native-svg-transformer`
// (see `metro.config.js`). Import them directly:
//
//   import Logo from '../src/assets/logo-wordmark.svg'
//   <Logo width={139} height={30} accessibilityLabel="RAW Radio" />
declare module '*.svg' {
  import type { FC } from 'react'
  import type { SvgProps } from 'react-native-svg'

  const content: FC<SvgProps>
  export default content
}
