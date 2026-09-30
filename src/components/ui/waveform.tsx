"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react"

import { cn } from "@/lib/utils"

export type WaveformProps = HTMLAttributes<HTMLDivElement> & {
  data?: number[]
  barWidth?: number
  barHeight?: number
  barGap?: number
  barRadius?: number
  barColor?: string
  fadeEdges?: boolean
  fadeWidth?: number
  height?: string | number
  active?: boolean
  onBarClick?: (index: number, value: number) => void
}

export const Waveform = ({
  data = [],
  barWidth = 4,
  barHeight: baseBarHeight = 4,
  barGap = 2,
  barRadius = 2,
  barColor,
  fadeEdges = true,
  fadeWidth = 24,
  height = 128,
  onBarClick,
  className,
  ...props
}: WaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const heightStyle = typeof height === "number" ? `${height}px` : height

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1

      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.scale(dpr, dpr)
        renderWaveform()
      }
    })

    const renderWaveform = () => {
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      const rect = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)

      const computedBarColor =
        barColor ||
        getComputedStyle(canvas).getPropertyValue("--foreground") ||
        "#000"

      const barCount = Math.floor(rect.width / (barWidth + barGap))
      const centerY = rect.height / 2

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * data.length)
        const value = data[dataIndex] || 0
        const barHeight = Math.max(baseBarHeight, value * rect.height * 0.8)
        const x = i * (barWidth + barGap)
        const y = centerY - barHeight / 2

        ctx.fillStyle = computedBarColor
        ctx.globalAlpha = 0.3 + value * 0.7

        if (barRadius > 0) {
          ctx.beginPath()
          ctx.roundRect(x, y, barWidth, barHeight, barRadius)
          ctx.fill()
        } else {
          ctx.fillRect(x, y, barWidth, barHeight)
        }
      }

      if (fadeEdges && fadeWidth > 0 && rect.width > 0) {
        const gradient = ctx.createLinearGradient(0, 0, rect.width, 0)
        const fadePercent = Math.min(0.2, fadeWidth / rect.width)

        gradient.addColorStop(0, "rgba(255,255,255,1)")
        gradient.addColorStop(fadePercent, "rgba(255,255,255,0)")
        gradient.addColorStop(1 - fadePercent, "rgba(255,255,255,0)")
        gradient.addColorStop(1, "rgba(255,255,255,1)")

        ctx.globalCompositeOperation = "destination-out"
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, rect.width, rect.height)
        ctx.globalCompositeOperation = "source-over"
      }

      ctx.globalAlpha = 1
    }

    resizeObserver.observe(container)
    renderWaveform()

    return () => resizeObserver.disconnect()
  }, [
    data,
    barWidth,
    baseBarHeight,
    barGap,
    barRadius,
    barColor,
    fadeEdges,
    fadeWidth,
  ])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onBarClick) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const barIndex = Math.floor(x / (barWidth + barGap))
    const dataIndex = Math.floor(
      (barIndex * data.length) / Math.floor(rect.width / (barWidth + barGap))
    )

    if (dataIndex >= 0 && dataIndex < data.length) {
      onBarClick(dataIndex, data[dataIndex])
    }
  }

  return (
    <div
      className={cn("relative min-w-0 overflow-hidden", className)}
      ref={containerRef}
      style={{ height: heightStyle }}
      {...props}
    >
      <canvas
        className="block h-full w-full"
        onClick={handleClick}
        ref={canvasRef}
      />
    </div>
  )
}

export type AudioScrubberProps = WaveformProps & {
  currentTime?: number
  duration?: number
  onSeek?: (time: number) => void
  showHandle?: boolean
}

export const AudioScrubber = ({
  data = [],
  currentTime = 0,
  duration = 100,
  onSeek,
  showHandle = true,
  barWidth = 3,
  barHeight,
  barGap = 1,
  barRadius = 1,
  barColor,
  height = 128,
  className,
  ...props
}: AudioScrubberProps) => {
  const [isDragging, setIsDragging] = useState(false)
  const [localProgress, setLocalProgress] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const safeCurrentTime =
    Number.isFinite(currentTime) && safeDuration > 0
      ? Math.max(0, Math.min(currentTime, safeDuration))
      : 0
  const currentProgress = safeDuration > 0 ? safeCurrentTime / safeDuration : 0
  const fallbackWaveformData = useMemo(
    () =>
      Array.from({ length: 100 }, (_, index) => {
        const primaryWave = Math.sin(index * 0.31) * 0.25
        const secondaryWave = Math.sin(index * 0.11 + 1.3) * 0.2

        return Math.max(0.12, Math.min(0.9, 0.45 + primaryWave + secondaryWave))
      }),
    []
  )

  const waveformData =
    data.length > 0
      ? data
      : fallbackWaveformData
  const displayedProgress = isDragging ? localProgress : currentProgress

  const handleScrub = useCallback(
    (clientX: number) => {
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || safeDuration === 0) return

      const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
      const progress = x / rect.width
      const newTime = progress * safeDuration

      setLocalProgress(progress)
      onSeek?.(newTime)
    },
    [safeDuration, onSeek]
  )

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
    handleScrub(e.clientX)
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      handleScrub(e.clientX)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isDragging, duration, handleScrub])

  const heightStyle = typeof height === "number" ? `${height}px` : height

  return (
    <div
      aria-label="Audio waveform scrubber"
      aria-valuemax={safeDuration}
      aria-valuemin={0}
      aria-valuenow={safeCurrentTime}
      className={cn("relative min-w-0 cursor-pointer select-none", className)}
      onMouseDown={handleMouseDown}
      ref={containerRef}
      role="slider"
      style={{ height: heightStyle }}
      tabIndex={0}
      {...props}
    >
      <Waveform
        barColor={barColor}
        barGap={barGap}
        barRadius={barRadius}
        barWidth={barWidth}
        barHeight={barHeight}
        height={height}
        data={waveformData}
        fadeEdges={false}
      />

      <div
        className="bg-org-accent/20 pointer-events-none absolute inset-y-0 left-0"
        style={{ width: `${displayedProgress * 100}%` }}
      />

      <div
        className="bg-org-accent pointer-events-none absolute top-0 bottom-0 w-0.5"
        style={{ left: `${displayedProgress * 100}%` }}
      />

      {showHandle && (
        <div
          className="border-background bg-org-accent pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg transition-transform hover:scale-110"
          style={{ left: `${displayedProgress * 100}%` }}
        />
      )}
    </div>
  )
}
