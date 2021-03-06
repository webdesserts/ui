import styled from 'styled-components';
import { fonts } from '../ui';

type HeadingSizes = "small" | "medium" | "large" 
type HeadingTags = "p" | "h1" | "h2" | "h3"
interface HeadingProps extends React.HTMLAttributes<HTMLElement>{
  as: HeadingTags,
  size: HeadingSizes,
}

export const Heading = styled.p<HeadingProps>`
  ${getSizedHeading}
  margin: 0;
  padding: 0;
`

Heading.defaultProps = {
  size: "medium"
}

function getSizedHeading (props: HeadingProps) {
  switch (props.size) {
    case "small": return fonts.heading_small;
    case "medium": return fonts.heading_medium;
    case "large": return fonts.heading_large;
  }
} 