import React from 'react'
import type { LucideIcon } from 'lucide-react-native'
// Deep per-icon imports (`lucide-react-native/icons/*`) keep Metro from pulling
// in the whole barrel (~1500 icons). Importing named icons from the package root
// still bundles every glyph, which bloats the RN/web bundle.
import Radio from 'lucide-react-native/icons/radio'
import Music from 'lucide-react-native/icons/music'
import Music2 from 'lucide-react-native/icons/music-2'
import Music3 from 'lucide-react-native/icons/music-3'
import Music4 from 'lucide-react-native/icons/music-4'
import Headphones from 'lucide-react-native/icons/headphones'
import Mic2 from 'lucide-react-native/icons/mic-vocal'
import Guitar from 'lucide-react-native/icons/guitar'
import Piano from 'lucide-react-native/icons/piano'
import Drum from 'lucide-react-native/icons/drum'
import Disc3 from 'lucide-react-native/icons/disc-3'
import Disc from 'lucide-react-native/icons/disc'
import Play from 'lucide-react-native/icons/play'
import Waves from 'lucide-react-native/icons/waves-horizontal'
import RadioTower from 'lucide-react-native/icons/radio-tower'
import Speaker from 'lucide-react-native/icons/speaker'
import Volume2 from 'lucide-react-native/icons/volume-2'
import Zap from 'lucide-react-native/icons/zap'
import Star from 'lucide-react-native/icons/star'
import Heart from 'lucide-react-native/icons/heart'
import Crown from 'lucide-react-native/icons/crown'
import Flame from 'lucide-react-native/icons/flame'
import Sparkles from 'lucide-react-native/icons/sparkles'
import Globe from 'lucide-react-native/icons/globe'
import Cloud from 'lucide-react-native/icons/cloud'
import Sun from 'lucide-react-native/icons/sun'
import Moon from 'lucide-react-native/icons/moon'
import Coffee from 'lucide-react-native/icons/coffee'
import Gamepad2 from 'lucide-react-native/icons/gamepad-2'
import Tv2 from 'lucide-react-native/icons/tv-minimal'
import Newspaper from 'lucide-react-native/icons/newspaper'
import Podcast from 'lucide-react-native/icons/mic-signal'
import Mic from 'lucide-react-native/icons/mic'
import Video from 'lucide-react-native/icons/video'
import Camera from 'lucide-react-native/icons/camera'
import Film from 'lucide-react-native/icons/film'
import Clapperboard from 'lucide-react-native/icons/clapperboard'
import FileAudio from 'lucide-react-native/icons/file-headphone'
import FileMusic from 'lucide-react-native/icons/file-music'
import Signal from 'lucide-react-native/icons/signal'
import Antenna from 'lucide-react-native/icons/antenna'
import Cast from 'lucide-react-native/icons/cast'
import Rss from 'lucide-react-native/icons/rss'

/**
 * Icons selectable for a substation in the admin (`SubstationEditModal.QUICK_ICONS`).
 *
 * Imported individually so Metro bundles only these 43 glyphs instead of the
 * whole Lucide set (~1500 icons). The 5 aliased names (`Mic2`, `Waves`, `Tv2`,
 * `Podcast`, `FileAudio`) point at their canonical deep-import files.
 */
const ICONS: Record<string, LucideIcon> = {
  Radio,
  Music,
  Music2,
  Music3,
  Music4,
  Headphones,
  Mic2,
  Guitar,
  Piano,
  Drum,
  Disc3,
  Disc,
  Play,
  Waves,
  RadioTower,
  Speaker,
  Volume2,
  Zap,
  Star,
  Heart,
  Crown,
  Flame,
  Sparkles,
  Globe,
  Cloud,
  Sun,
  Moon,
  Coffee,
  Gamepad2,
  Tv2,
  Newspaper,
  Podcast,
  Mic,
  Video,
  Camera,
  Film,
  Clapperboard,
  FileAudio,
  FileMusic,
  Signal,
  Antenna,
  Cast,
  Rss,
}

interface SubstationIconProps {
  /** Lucide icon name sent by the server (e.g. `Radio`, `Guitar`). */
  name: string
  size: number
  color: string
}

/** Renders the substation's Lucide icon, falling back to `Radio` for unknown names. */
export function SubstationIcon({ name, size, color }: SubstationIconProps) {
  const Icon = ICONS[name] ?? Radio
  return <Icon size={size} color={color} strokeWidth={2} />
}
