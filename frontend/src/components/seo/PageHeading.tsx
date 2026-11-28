import type { HTMLAttributes, ReactNode } from 'react'

type Props = HTMLAttributes<HTMLHeadingElement> & {
  children: ReactNode
  /**
   * Pages server-render both a desktop and a mobile tree (one hidden with CSS).
   * Only the desktop tree emits the real <h1>, so the HTML has exactly one; the
   * mobile copy is a level-1 ARIA heading, which is what assistive tech sees on
   * phones (the hidden desktop tree is out of the accessibility tree there).
   */
  mobile?: boolean
}

/** Page title heading that keeps one <h1> per page across desktop + mobile trees. */
export default function PageHeading({ mobile = false, children, ...rest }: Props) {
  if (mobile) {
    return (
      <p role="heading" aria-level={1} {...rest}>
        {children}
      </p>
    )
  }
  return <h1 {...rest}>{children}</h1>
}
