import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { gsap } from "gsap";
import { GoArrowUpRight } from "react-icons/go";
import "./CardNav.css";

/**
 * Ported from React Bits (CardNav) to TypeScript and extended for Zen so it can
 * serve as the real app header: links carry onClick handlers, the logo is
 * clickable, and there are slots for always-visible top-bar controls
 * (`topExtras`) and expanded-panel content above the cards (`expandedTop`, used
 * for the Deep Work session tabs). Height is measured from content so extra
 * rows fit.
 */

export interface CardNavLink {
  label: string;
  href?: string;
  ariaLabel?: string;
  onClick?: () => void;
  active?: boolean;
}
export interface CardNavItem {
  label: string;
  bgColor: string;
  textColor: string;
  links: CardNavLink[];
}
/** Collapsed bar height — keep in sync with `.card-nav` / `.card-nav-top` CSS. */
const COLLAPSED_H = 40;

export interface CardNavProps {
  logoText?: string;
  onLogoClick?: () => void;
  items: CardNavItem[];
  className?: string;
  ease?: string;
  baseColor?: string;
  menuColor?: string;
  buttonBgColor?: string;
  buttonTextColor?: string;
  ctaLabel?: string;
  onCta?: () => void;
  /** Always-visible controls rendered in the top bar, before the CTA. */
  topExtras?: ReactNode;
  /** Always-visible content in the top bar between the logo and the controls
   *  (e.g. the Deep Work session tabs). */
  centerSlot?: ReactNode;
  /** Full-width content rendered inside the expanded panel, above the cards. */
  expandedTop?: ReactNode;
}

export default function CardNav({
  logoText = "Zen",
  onLogoClick,
  items,
  className = "",
  ease = "power3.out",
  baseColor = "var(--bg-elev)",
  menuColor = "var(--text)",
  buttonBgColor = "var(--accent)",
  buttonTextColor = "#0b0b0f",
  ctaLabel,
  onCta,
  topExtras,
  centerSlot,
  expandedTop,
}: CardNavProps) {
  const [isHamburgerOpen, setIsHamburgerOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const navRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const calculateHeight = () => {
    const navEl = navRef.current;
    if (!navEl) return 260;
    const contentEl = navEl.querySelector<HTMLElement>(".card-nav-content");
    if (!contentEl) return 260;
    const prev = {
      v: contentEl.style.visibility, p: contentEl.style.pointerEvents,
      pos: contentEl.style.position, h: contentEl.style.height,
    };
    contentEl.style.visibility = "visible";
    contentEl.style.pointerEvents = "auto";
    contentEl.style.position = "static";
    contentEl.style.height = "auto";
    // Cards may still carry the closed-state translateY(50px), which inflates
    // scrollHeight and leaves a phantom gap under the cards — measure untransformed.
    const cards = Array.from(contentEl.querySelectorAll<HTMLElement>(".nav-card"));
    const prevTransforms = cards.map((c) => c.style.transform);
    cards.forEach((c) => (c.style.transform = "none"));
    void contentEl.offsetHeight;
    const height = COLLAPSED_H + contentEl.scrollHeight;
    cards.forEach((c, i) => (c.style.transform = prevTransforms[i]));
    contentEl.style.visibility = prev.v;
    contentEl.style.pointerEvents = prev.p;
    contentEl.style.position = prev.pos;
    contentEl.style.height = prev.h;
    return height;
  };

  const createTimeline = () => {
    const navEl = navRef.current;
    if (!navEl) return null;
    gsap.set(navEl, { height: COLLAPSED_H, overflow: "hidden" });
    gsap.set(cardsRef.current, { y: 50, opacity: 0 });
    const tl = gsap.timeline({ paused: true });
    tl.to(navEl, { height: calculateHeight, duration: 0.4, ease });
    tl.to(cardsRef.current, { y: 0, opacity: 1, duration: 0.4, ease, stagger: 0.08 }, "-=0.1");
    return tl;
  };

  // Build the timeline once (and on resize). It must NOT depend on `items` /
  // `expandedTop`, which are new references every render — rebuilding on each
  // render would reset the paused timeline and swallow the open animation.
  useLayoutEffect(() => {
    const tl = createTimeline();
    tlRef.current = tl;
    const onResize = () => {
      const wasOpen = tlRef.current?.progress() === 1;
      tlRef.current?.kill();
      const next = createTimeline();
      tlRef.current = next;
      if (next && wasOpen) next.progress(1);
    };
    window.addEventListener("resize", onResize);
    return () => { tl?.kill(); tlRef.current = null; window.removeEventListener("resize", onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ease]);

  const toggleMenu = () => {
    const tl = tlRef.current;
    if (!tl) return;
    if (!isExpanded) {
      setIsHamburgerOpen(true);
      setIsExpanded(true);
      tl.play(0);
    } else {
      setIsHamburgerOpen(false);
      tl.eventCallback("onReverseComplete", () => setIsExpanded(false));
      tl.reverse();
    }
  };

  const collapse = () => {
    const tl = tlRef.current;
    if (!tl || !isExpanded) return;
    setIsHamburgerOpen(false);
    tl.eventCallback("onReverseComplete", () => setIsExpanded(false));
    tl.reverse();
  };

  const handleLink = (link: CardNavLink) => {
    if (link.onClick) { link.onClick(); collapse(); }
  };

  return (
    <div className={`card-nav-container ${className}`}>
      <nav ref={navRef} className={`card-nav ${isExpanded ? "open" : ""}`} style={{ backgroundColor: baseColor }}>
        <div className="card-nav-top">
          <div
            className={`hamburger-menu ${isHamburgerOpen ? "open" : ""}`}
            onClick={toggleMenu}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMenu(); } }}
            role="button"
            aria-label={isExpanded ? "Close menu" : "Open menu"}
            aria-expanded={isExpanded}
            tabIndex={0}
            style={{ color: menuColor }}
          >
            <div className="hamburger-line" />
            <div className="hamburger-line" />
          </div>
          <button type="button" className="logo-container" onClick={onLogoClick} title="Home">
            <span className="card-nav-logo-text">{logoText}</span>
          </button>
          {centerSlot && <div className="card-nav-center">{centerSlot}</div>}
          <div className="card-nav-right">
            {topExtras}
            {ctaLabel && (
              <button type="button" className="card-nav-cta-button" style={{ backgroundColor: buttonBgColor, color: buttonTextColor }} onClick={onCta}>
                {ctaLabel}
              </button>
            )}
          </div>
        </div>
        <div className="card-nav-content" aria-hidden={!isExpanded}>
          {expandedTop && <div className="card-nav-expanded-top">{expandedTop}</div>}
          <div className="card-nav-cards">
            {items.slice(0, 3).map((item, idx) => (
              <div
                key={`${item.label}-${idx}`}
                className="nav-card"
                ref={(el) => { cardsRef.current[idx] = el; }}
                style={{ backgroundColor: item.bgColor, color: item.textColor }}
              >
                <div className="nav-card-label">{item.label}</div>
                <div className="nav-card-links">
                  {item.links.map((lnk, i) => (
                    <a
                      key={`${lnk.label}-${i}`}
                      className={`nav-card-link${lnk.active ? " nav-card-link--active" : ""}`}
                      href={lnk.href}
                      aria-label={lnk.ariaLabel}
                      onClick={(e) => { if (lnk.onClick) { e.preventDefault(); handleLink(lnk); } }}
                    >
                      <GoArrowUpRight className="nav-card-link-icon" aria-hidden="true" />
                      {lnk.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
}
