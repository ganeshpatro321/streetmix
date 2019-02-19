import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { IntlProvider, FormattedMessage } from 'react-intl'
import Triangle from './Triangle'
import RemoveButton from './RemoveButton'
import Variants from './Variants'
import WidthControl from './WidthControl'
import BuildingHeightControl from './BuildingHeightControl'
import Warnings from './Warnings'
import Description from './Description'
import DebugHoverPolygon from './DebugHoverPolygon'
import { infoBubble } from './info_bubble'
import {
  INFO_BUBBLE_TYPE_SEGMENT,
  INFO_BUBBLE_TYPE_LEFT_BUILDING,
  INFO_BUBBLE_TYPE_RIGHT_BUILDING
} from './constants'
import { registerKeypress } from '../app/keypress'
import { cancelFadeoutControls, resumeFadeoutControls } from '../segments/resizing'
// import { trackEvent } from '../app/event_tracking'
import { BUILDINGS } from '../segments/buildings'
import { getSegmentInfo, getSegmentVariantInfo } from '../segments/info'
import { getSegmentEl } from '../segments/view'
import { loseAnyFocus } from '../util/focus'
import { getElAbsolutePos } from '../util/helpers'
import { setInfoBubbleMouseInside } from '../store/actions/infoBubble'
import './InfoBubble.scss'

const INFO_BUBBLE_MARGIN_BUBBLE = 20
const INFO_BUBBLE_MARGIN_MOUSE = 10

const DESCRIPTION_HOVER_POLYGON_MARGIN = 200

const MIN_TOP_MARGIN_FROM_VIEWPORT = 120
const MIN_SIDE_MARGIN_FROM_VIEWPORT = 50

class InfoBubble extends React.Component {
  static propTypes = {
    visible: PropTypes.bool.isRequired,
    descriptionVisible: PropTypes.bool,
    mouseInside: PropTypes.bool,
    position: PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number
    ]),
    setInfoBubbleMouseInside: PropTypes.func,
    street: PropTypes.object,
    system: PropTypes.object,
    locale: PropTypes.object
  }

  static defaultProps = {
    visible: false
  }

  constructor (props) {
    super(props)

    // Stores a ref to the element
    this.el = React.createRef()
    this.segmentEl = getSegmentEl(props.position)
    this.streetOuterEl = null

    this.state = {
      type: null,
      highlightTriangle: false,
      hoverPolygon: []
    }

    this.hoverPolygonUpdateTimerId = -1

    // Register keyboard shortcuts to hide info bubble
    // Only hide if it's currently visible, and if the
    // description is NOT visible. (If the description
    // is visible, the escape key should hide that first.)
    registerKeypress('esc', {
      condition: () => this.props.visible && !this.props.descriptionVisible
    }, () => {
      infoBubble.hide()
      infoBubble.hideSegment(false)
    })
  }

  /**
   * Sets state when the infobubble is pointing at a building
   *
   * @param {Object} nextProps
   * @param {Object} prevState
   */
  static getDerivedStateFromProps (nextProps, prevState) {
    if (nextProps.position === 'left') {
      return {
        type: INFO_BUBBLE_TYPE_LEFT_BUILDING
      }
    } else if (nextProps.position === 'right') {
      return {
        type: INFO_BUBBLE_TYPE_RIGHT_BUILDING
      }
    } else {
      return {
        type: INFO_BUBBLE_TYPE_SEGMENT
      }
    }
  }

  componentDidMount () {
    // This listener hides the info bubble when the mouse leaves the
    // document area. Do not normalize it to a pointerleave event
    // because it doesn't make sense for other pointer types
    document.addEventListener('mouseleave', this.hide)

    // Cache reference to this element
    this.streetOuterEl = document.querySelector('#street-section-outer')
  }

  getSnapshotBeforeUpdate (prevProps, prevState) {
    const wasBuilding = (prevState.type !== INFO_BUBBLE_TYPE_SEGMENT)

    if (!this.el || !this.el.current) return null

    if (!wasBuilding && this.props.position === 'right') {
      return this.props.system.viewportWidth - MIN_SIDE_MARGIN_FROM_VIEWPORT
    }
    return null
  }

  componentDidUpdate (prevProps, prevState, snapshot) {
    this.segmentEl = getSegmentEl(this.props.position)
    this.setInfoBubblePosition()

    // If info bubble changes, wake this back up if it's fading out
    cancelFadeoutControls()

    this.updateBubbleDimensions(snapshot)

    // Add or remove event listener based on whether infobubble was shown or hidden
    if (prevProps.visible === false && this.props.visible === true) {
      document.body.addEventListener('mousemove', this.onBodyMouseMove)
    } else if (prevProps.visible === true && this.props.visible === false) {
      document.body.removeEventListener('mousemove', this.onBodyMouseMove)
    }

    // this.updateHoverPolygon(infoBubble.considerMouseX, infoBubble.considerMouseY)
  }

  componentWillUnmount () {
    // Clean up event listener
    document.removeEventListener('mouseleave', this.hide)
  }

  componentDidCatch (error) {
    console.error(error)
  }

  hide = () => {
    infoBubble.hide()
  }

  onTouchStart (event) {
    resumeFadeoutControls()
  }

  // TODO: verify this continues to work with pointer / touch taps
  onMouseEnter = (event) => {
    this.props.setInfoBubbleMouseInside(true)

    this.updateHoverPolygon()
  }

  onMouseLeave = (event) => {
    this.props.setInfoBubbleMouseInside(false)

    // Returns focus to body when pointer leaves the info bubble area
    // so that keyboard commands respond to pointer position rather than
    // any focused buttons/inputs
    loseAnyFocus()
  }

  onBodyMouseMove = (event) => {
    const mouseX = event.pageX
    const mouseY = event.pageY

    if (this.props.visible) {
      if (!infoBubble._withinHoverPolygon(mouseX, mouseY)) {
        infoBubble.show(false)
      }
    }

    window.clearTimeout(this.hoverPolygonUpdateTimerId)

    this.hoverPolygonUpdateTimerId = window.setTimeout(() => {
      this.updateHoverPolygon(mouseX, mouseY)
    }, 50)
  }

  highlightTriangle = (event) => {
    this.setState({ highlightTriangle: true })
  }

  unhighlightTriangle = (event) => {
    this.setState({ highlightTriangle: false })
  }

  updateHoverPolygon = (mouseX, mouseY) => {
    const polygon = this.createHoverPolygon(mouseX, mouseY)

    this.setState({
      hoverPolygon: polygon
    })

    // Legacy update
    infoBubble.hoverPolygon = polygon
  }

  // TODO: make this a pure(r) function
  createHoverPolygon = (mouseX, mouseY) => {
    // `hoverPolygon` is an array of points as [x, y] values. Values should
    // draw a shape counter-clockwise. The final value must match the first
    // value in order to create an enclosed polygon.
    let hoverPolygon = []

    if (!this.props.visible) {
      return hoverPolygon
    }

    // Bail if any reference to an element no longer exists
    if (!this.el || !this.el.current || !this.segmentEl) return

    const bubbleWidth = this.el.current.offsetWidth
    const bubbleHeight = this.el.current.offsetHeight
    const bubbleX = Number.parseInt(this.el.current.style.left)
    const bubbleY = Number.parseInt(this.el.current.style.top)

    if (this.props.mouseInside && !this.props.descriptionVisible) {
      const pos = getElAbsolutePos(this.segmentEl)

      // Left X position of segment element
      const segmentX1a = pos[0] - document.querySelector('#street-section-outer').scrollLeft
      // Right X position of segment element
      const segmentX2a = segmentX1a + this.segmentEl.offsetWidth
      // Left X position of segment element with margin
      const segmentX1 = segmentX1a - INFO_BUBBLE_MARGIN_BUBBLE
      // Right X position of segment element with margin
      const segmentX2 = segmentX2a + INFO_BUBBLE_MARGIN_BUBBLE

      // Top Y position of segment element
      const segmentY1a = pos[1]
      // Bottom Y position of segment element
      const segmentY2a = segmentY1a + this.segmentEl.offsetHeight
      // Bottom Y position of segment element with margin
      const segmentY2 = segmentY2a + INFO_BUBBLE_MARGIN_BUBBLE

      hoverPolygon = [
        // Top left of infobubble
        [bubbleX - INFO_BUBBLE_MARGIN_BUBBLE, bubbleY - INFO_BUBBLE_MARGIN_BUBBLE],
        // Bottom left of infobubble
        [bubbleX - INFO_BUBBLE_MARGIN_BUBBLE, bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE],
        // Diagonal line to hit edge of segment
        [segmentX1, bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE + 120],
        // Bottom left of segment
        [segmentX1, segmentY2],
        // Bottom right of segment
        [segmentX2, segmentY2],
        // Point at which to begin diagonal line to infobubble
        [segmentX2, bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE + 120],
        // Bottom right of infobubble
        [bubbleX + bubbleWidth + INFO_BUBBLE_MARGIN_BUBBLE, bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE],
        // Top right of infobubble
        [bubbleX + bubbleWidth + INFO_BUBBLE_MARGIN_BUBBLE, bubbleY - INFO_BUBBLE_MARGIN_BUBBLE],
        // Top left of infobubble (starting point)
        [bubbleX - INFO_BUBBLE_MARGIN_BUBBLE, bubbleY - INFO_BUBBLE_MARGIN_BUBBLE]
      ]
    } else {
      let bottomY = mouseY - INFO_BUBBLE_MARGIN_MOUSE
      if (bottomY < bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE) {
        bottomY = bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE
      }
      let bottomY2 = mouseY + INFO_BUBBLE_MARGIN_MOUSE
      if (bottomY2 < bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE) {
        bottomY2 = bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE
      }

      if (this.props.descriptionVisible) {
        bottomY = bubbleY + bubbleHeight + DESCRIPTION_HOVER_POLYGON_MARGIN + 300
        bottomY2 = bottomY

        hoverPolygon = [
          [bubbleX - DESCRIPTION_HOVER_POLYGON_MARGIN, bubbleY - DESCRIPTION_HOVER_POLYGON_MARGIN],
          [bubbleX - DESCRIPTION_HOVER_POLYGON_MARGIN, bubbleY + bubbleHeight + DESCRIPTION_HOVER_POLYGON_MARGIN + 300],
          [bubbleX + bubbleWidth + DESCRIPTION_HOVER_POLYGON_MARGIN, bubbleY + bubbleHeight + DESCRIPTION_HOVER_POLYGON_MARGIN + 300],
          [bubbleX + bubbleWidth + DESCRIPTION_HOVER_POLYGON_MARGIN, bubbleY - DESCRIPTION_HOVER_POLYGON_MARGIN],
          [bubbleX - DESCRIPTION_HOVER_POLYGON_MARGIN, bubbleY - DESCRIPTION_HOVER_POLYGON_MARGIN]
        ]
      } else {
        let diffX = 60 - ((mouseY - bubbleY) / 5)
        if (diffX < 0) {
          diffX = 0
        } else if (diffX > 50) {
          diffX = 50
        }

        hoverPolygon = [
          [bubbleX - INFO_BUBBLE_MARGIN_BUBBLE, bubbleY - INFO_BUBBLE_MARGIN_BUBBLE],
          [bubbleX - INFO_BUBBLE_MARGIN_BUBBLE, bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE],
          [(bubbleX - INFO_BUBBLE_MARGIN_BUBBLE + mouseX - INFO_BUBBLE_MARGIN_MOUSE - diffX) / 2, bottomY + ((bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE - bottomY) * 0.2)],
          [mouseX - INFO_BUBBLE_MARGIN_MOUSE - diffX, bottomY],
          [mouseX - INFO_BUBBLE_MARGIN_MOUSE, bottomY2],
          [mouseX + INFO_BUBBLE_MARGIN_MOUSE, bottomY2],
          [mouseX + INFO_BUBBLE_MARGIN_MOUSE + diffX, bottomY],
          [(bubbleX + bubbleWidth + INFO_BUBBLE_MARGIN_BUBBLE + mouseX + INFO_BUBBLE_MARGIN_MOUSE + diffX) / 2, bottomY + ((bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE - bottomY) * 0.2)],
          [bubbleX + bubbleWidth + INFO_BUBBLE_MARGIN_BUBBLE, bubbleY + bubbleHeight + INFO_BUBBLE_MARGIN_BUBBLE],
          [bubbleX + bubbleWidth + INFO_BUBBLE_MARGIN_BUBBLE, bubbleY - INFO_BUBBLE_MARGIN_BUBBLE],
          [bubbleX - INFO_BUBBLE_MARGIN_BUBBLE, bubbleY - INFO_BUBBLE_MARGIN_BUBBLE]
        ]
      }
    }

    return hoverPolygon
  }

  /**
   * TODO: consolidate this with the dim calc in updateBubbleDimensions? do we need snapshot here?
   */
  setInfoBubblePosition = () => {
    if (!this.segmentEl || !this.el || !this.el.current || !this.props.visible) return

    // Determine dimensions and X/Y layout
    const bubbleWidth = this.el.current.offsetWidth
    const bubbleHeight = this.el.current.offsetHeight
    const pos = getElAbsolutePos(this.segmentEl)

    let bubbleX = pos[0] - this.streetOuterEl.scrollLeft
    let bubbleY = pos[1]

    // TODO const
    bubbleY -= bubbleHeight - 20
    if (bubbleY < MIN_TOP_MARGIN_FROM_VIEWPORT) {
      bubbleY = MIN_TOP_MARGIN_FROM_VIEWPORT
    }

    bubbleX += this.segmentEl.offsetWidth / 2
    bubbleX -= bubbleWidth / 2

    if (bubbleX < MIN_SIDE_MARGIN_FROM_VIEWPORT) {
      bubbleX = MIN_SIDE_MARGIN_FROM_VIEWPORT
    } else if (bubbleX > this.props.system.viewportWidth - bubbleWidth - MIN_SIDE_MARGIN_FROM_VIEWPORT) {
      bubbleX = this.props.system.viewportWidth - bubbleWidth - MIN_SIDE_MARGIN_FROM_VIEWPORT
    }

    this.el.current.style.left = bubbleX + 'px'
    this.el.current.style.top = bubbleY + 'px'
  }

  updateBubbleDimensions = (snapshot) => {
    if (!this.el || !this.el.current) return

    let bubbleHeight

    const el = this.el.current.querySelector('.description-canvas')

    if (this.props.descriptionVisible && el) {
      const pos = getElAbsolutePos(el)
      bubbleHeight = pos[1] + el.offsetHeight - 38
    } else {
      bubbleHeight = this.el.current.offsetHeight
    }

    const height = bubbleHeight + 30

    this.el.current.style.webkitTransformOrigin = '50% ' + height + 'px'
    this.el.current.style.MozTransformOrigin = '50% ' + height + 'px'
    this.el.current.style.transformOrigin = '50% ' + height + 'px'

    // When the infoBubble needed to be shown for the right building, the offsetWidth
    // used to calculate the left style was from the previous rendering of this component.
    // This meant that if the last time the infoBubble was shown was for a segment, then the
    // offsetWidth used to calculate the new left style would be smaller than it should be.
    // The current solution is to manually recalculate the left style and set the style
    // when hovering over the right building.

    if (snapshot) {
      const bubbleX = (snapshot - this.el.current.offsetWidth)
      this.el.current.style.left = bubbleX + 'px'
    }
  }

  /**
   * Retrieve name from segment data. It should also find the equivalent strings from the
   * translation files if provided.
   */
  getName = () => {
    let id
    let defaultMessage = ''

    switch (this.state.type) {
      case INFO_BUBBLE_TYPE_SEGMENT: {
        const segment = this.props.street.segments[this.props.position]
        if (segment) {
          const segmentInfo = getSegmentInfo(segment.type)
          const variantInfo = getSegmentVariantInfo(segment.type, segment.variantString)
          const key = variantInfo.nameKey || segmentInfo.nameKey

          id = `segments.${key}`
          defaultMessage = variantInfo.name || segmentInfo.name
        }
        break
      }
      case INFO_BUBBLE_TYPE_LEFT_BUILDING: {
        const key = this.props.street.leftBuildingVariant

        id = `buildings.${key}.name`
        defaultMessage = BUILDINGS[key].label

        break
      }
      case INFO_BUBBLE_TYPE_RIGHT_BUILDING: {
        const key = this.props.street.rightBuildingVariant

        id = `buildings.${key}.name`
        defaultMessage = BUILDINGS[key].label

        break
      }
      default:
        break
    }

    return (id) ? (
      <IntlProvider
        locale={this.props.locale.locale}
        messages={this.props.locale.segmentInfo}
      >
        <FormattedMessage id={id} defaultMessage={defaultMessage} />
      </IntlProvider>
    ) : null
  }

  render () {
    const type = this.state.type
    const canBeDeleted = (type === INFO_BUBBLE_TYPE_SEGMENT && this.props.position !== null)

    // Set class names
    const classNames = ['info-bubble']

    classNames.push((type === INFO_BUBBLE_TYPE_SEGMENT) ? 'info-bubble-type-segment' : 'info-bubble-type-building')
    if (this.props.visible) {
      classNames.push('visible')
    }
    if (this.props.descriptionVisible) {
      classNames.push('show-description')
    }

    // Determine position
    let position
    switch (type) {
      case INFO_BUBBLE_TYPE_SEGMENT:
        position = this.props.position
        break
      case INFO_BUBBLE_TYPE_LEFT_BUILDING:
        position = 'left'
        break
      case INFO_BUBBLE_TYPE_RIGHT_BUILDING:
        position = 'right'
        break
      default:
        position = null
        break
    }

    // Determine width or height control type
    let widthOrHeightControl
    switch (type) {
      case INFO_BUBBLE_TYPE_SEGMENT:
        widthOrHeightControl = <WidthControl position={position} />
        break
      case INFO_BUBBLE_TYPE_LEFT_BUILDING:
      case INFO_BUBBLE_TYPE_RIGHT_BUILDING:
        widthOrHeightControl = <BuildingHeightControl position={position} />
        break
      default:
        widthOrHeightControl = null
        break
    }

    const segment = this.props.street.segments[this.props.position] || {}

    return (
      <React.Fragment>
        <div
          className={classNames.join(' ')}
          onMouseEnter={this.onMouseEnter}
          onMouseLeave={this.onMouseLeave}
          onTouchStart={this.onTouchStart}
          ref={this.el}
        >
          <Triangle highlight={this.state.highlightTriangle} />
          <header>
            <div className="info-bubble-header-label">{this.getName()}</div>
            {canBeDeleted && <RemoveButton segment={this.props.position} />}
          </header>
          <div className="info-bubble-controls">
            <IntlProvider
              locale={this.props.locale.locale}
              messages={this.props.locale.segmentInfo}
            >
              <Variants type={type} position={position} />
            </IntlProvider>
            {widthOrHeightControl}
          </div>
          <Warnings segment={segment} />
          <Description
            type={segment.type}
            variantString={segment.variantString}
            updateBubbleDimensions={this.updateBubbleDimensions}
            highlightTriangle={this.highlightTriangle}
            unhighlightTriangle={this.unhighlightTriangle}
            infoBubbleEl={this.el.current}
            updateHoverPolygon={this.updateHoverPolygon}
          />
        </div>
        {this.props.visible && (
          <DebugHoverPolygon
            hoverPolygon={this.state.hoverPolygon}
          />
        )}
      </React.Fragment>
    )
  }
}

function mapStateToProps (state) {
  return {
    visible: state.infoBubble.visible,
    descriptionVisible: state.infoBubble.descriptionVisible,
    mouseInside: state.infoBubble.mouseInside,
    position: state.ui.activeSegment,
    street: state.street,
    system: state.system,
    locale: state.locale
  }
}

function mapDispatchToProps (dispatch) {
  return {
    setInfoBubbleMouseInside: (value) => { dispatch(setInfoBubbleMouseInside(value)) }
  }
}

export default connect(mapStateToProps, mapDispatchToProps)(InfoBubble)
