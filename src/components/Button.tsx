import styled, { css } from 'styled-components'
import { colors, fonts, mixins } from '../ui';

const buttonStyles = css`
  ${fonts.heading_small}
  ${mixins.focus_outline}
  ${mixins.spread({
    to: css`
      width: 100%;
      height: 100%;
      bottom: 0;
    `,
    from: css`
      background-color: ${colors.primary};
      height: 2px; 
      width: 24px;
      top: initial;
      bottom: 4px;
    `
  })}
  position: relative;
  display: flex;
  align-items: center;
  height: 32px;
  transition: color 200ms ease, padding 200ms ease;

  &:hover,
  &:focus {
    padding: 0 8px;
  }
`

export const Button = styled.button`
  ${buttonStyles}
  background: none;
  border: none;
  box-shadow: none;
  padding: 0;
  cursor: pointer;

  &[disabled] {
    pointer-events: none;
    &::after {
      background-color: ${colors.mid};
    }
  }
`

export const ButtonLink = styled.a`
  ${buttonStyles}
  text-decoration: none;

  &:hover,
  &:focus {
    text-decoration: underline;
  }
`;