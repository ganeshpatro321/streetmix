import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'

export class DebugHoverPolygon extends React.Component {
  static propTypes = {
    enabled: PropTypes.bool,
    hoverPolygon: PropTypes.array
  }

  static defaultProps = {
    enabled: false,
    hoverPolygon: []
  }

  constructor (props) {
    super(props)

    this.canvas = React.createRef()
  }

  componentDidMount () {
    window.addEventListener('resize', this.handleWindowResize)
  }

  componentWillUnmount () {
    window.removeEventListener('resize', this.handleWindowResize)
  }

  shouldComponentUpdate () {
    return this.props.enabled
  }

  componentDidUpdate () {
    this.drawPolygon()
  }

  handleWindowResize = (event) => {
    if (this.props.enabled === false) return

    this.forceUpdate()
  }

  drawPolygon = () => {
    if (this.props.enabled === false) return
    if (!this.canvas.current) return

    this.canvas.current.width = this.canvas.current.width // Setting canvas width will clear it

    const polygon = this.props.hoverPolygon

    // Early exit if polygon isn't set
    if (!polygon.length || !polygon[0].length) return

    const ctx = this.canvas.current.getContext('2d')
    ctx.strokeStyle = 'red'
    ctx.fillStyle = 'rgba(255, 0, 0, .1)'
    ctx.beginPath()
    ctx.moveTo(polygon[0][0], polygon[0][1])
    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(polygon[i][0], polygon[i][1])
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  render () {
    if (this.props.enabled === false) return null

    return (
      <div className="debug-hover-polygon">
        <canvas
          width={window.innerWidth}
          height={window.innerHeight}
          ref={this.canvas}
        />
      </div>
    )
  }
}

function mapStateToProps (state) {
  return {
    enabled: state.flags.INFO_BUBBLE_HOVER_POLYGON.value
  }
}

export default connect(mapStateToProps)(DebugHoverPolygon)
