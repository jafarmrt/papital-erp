import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import type { SiteSlide } from '../../lib/home';
import type { SitePageImage } from '../../lib/pages';
import { usePageMediaPath } from '../../lib/pageMedia';
import { faNumber } from '../../lib/format';

/** how long a slide stays before the slider moves on by itself (start plan §7.2) */
export const SLIDE_SECONDS = 6;

/**
 * v12 phase 10e: the home page's «اسلایدر» and «بنر». The slider is a row the browser itself scrolls and snaps, so it
 * works by a swipe before any script has loaded and needs no library; the arrows, the dots and its own movement only
 * ask the browser to scroll. Every slide has the same box (4:5 on a phone held upright, 8:3 otherwise, and never
 * more than 78% of the window's height), whatever the shape of its image, so nothing jumps; the image fills the box,
 * and a phone held upright gets the other crop when the shop chose one. The words stand over the foot of the image
 * and are part of the box's height: a long title or text is shortened to two or three lines, and words still too
 * tall for the box make the row taller (every slide with it), so the box never cuts them. The first slide's image is loaded early (it is the largest thing on
 * the page).
 *
 * It moves on by itself every six seconds, and stops while the pointer is over it or the focus is inside it, for good
 * once the visitor moves it by hand (an arrow, a dot, a swipe, the arrow keys) or presses «ایستادن», and never starts
 * for a visitor who asked for less motion.
 * Without the script the first slide is there and the row still scrolls; the controls are drawn only once they work.
 */
function WideImage({ image, mobile, eager, fill }: { image: SitePageImage; mobile: SitePageImage | null; eager: boolean; /** fill the slide's box */ fill: boolean }) {
  const media = usePageMediaPath();
  const [width, height] = [image.width ?? 1600, image.height ?? 600];
  return (
    <picture className={fill ? 'absolute inset-0 block overflow-hidden' : undefined}>
      {/* a slide's box is upright only on a phone held upright, so only there is the upright crop the right one */}
      {mobile ? <source media={fill ? '(max-width: 639px) and (orientation: portrait)' : '(max-width: 639px)'} srcSet={media(mobile.sha256)} width={mobile.width ?? 800} height={mobile.height ?? 1000} /> : null}
      <img
        src={media(image.sha256)} alt={image.alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined} decoding="async"
        className={fill ? 'block h-full w-full bg-muted object-cover' : 'block h-auto max-h-[78vh] w-full bg-muted object-cover'}
      />
    </picture>
  );
}

function SlideLink({ slide, className, children }: { slide: Pick<SiteSlide, 'href' | 'external'>; className: string; children: React.ReactNode }) {
  return slide.external
    ? <a href={slide.href} rel="noopener noreferrer" className={className}>{children}</a>
    : <Link to={slide.href} className={className}>{children}</Link>;
}

const lessMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function HomeSlider({ slides, heading }: { slides: readonly SiteSlide[]; /** the first slide's title is the page's `<h1>` */ heading: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  // where the slider is, or is on its way to: two quick presses of «بعدی» move two slides
  const aim = useRef(0);
  const many = slides.length > 1;
  // the controls are drawn once the script that makes them work has loaded
  const [ready, setReady] = useState(false);
  // a visitor who asked for less motion: nothing moves by itself and nothing glides
  const [calm, setCalm] = useState(true);
  const [playing, setPlaying] = useState(false);
  // two holds, each lifted by its own end: the pointer over the slider, and the focus inside it
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const touchFrom = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!many) return;
    setReady(true);
    setCalm(lessMotion());
    setPlaying(!lessMotion());
  }, [many]);
  // the slide most in view is the current one, however the visitor got there (a swipe, an arrow, a dot, the keyboard)
  useEffect(() => {
    const list = track.current;
    if (!list || !many || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number((entry.target as HTMLElement).dataset.slide);
        aim.current = index;
        setCurrent(index);
      }
    }, { root: list, threshold: 0.6 });
    for (const item of Array.from(list.children)) seen.observe(item);
    return () => seen.disconnect();
  }, [many, slides.length]);
  const go = useCallback((index: number) => {
    const list = track.current;
    const next = (index + slides.length) % slides.length;
    const item = list?.children[next] as HTMLElement | undefined;
    if (!list || !item) return;
    aim.current = next;
    // the row alone is scrolled (never the page, which a slider out of view would otherwise pull back to itself)
    list.scrollTo({ left: list.scrollLeft + item.getBoundingClientRect().left - list.getBoundingClientRect().left, behavior: lessMotion() ? 'auto' : 'smooth' });
  }, [slides.length]);
  useEffect(() => {
    if (!playing || hovered || focused) return undefined;
    const timer = window.setInterval(() => { if (!document.hidden) go(aim.current + 1); }, SLIDE_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [playing, hovered, focused, go]);
  /** the visitor moves the slider: from here on it is theirs */
  const byHand = (index: number) => {
    setPlaying(false);
    go(index);
  };
  const round = 'inline-flex size-11 items-center justify-center';
  // a phone has the swipe and the dots; the arrows come from 640 px
  const arrow = 'absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-foreground shadow hover:bg-card sm:inline-flex';
  return (
    <section
      aria-roledescription="carousel" aria-label="اسلایدهای صفحهٔ اصلی" className="relative border-b border-border bg-muted" data-home-part="slider"
      onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }} onPointerLeave={() => setHovered(false)}
      // the focus a keyboard brings: a tap or a click on a slide (which focuses the row) holds nothing
      onFocus={(event) => { if ((event.target as HTMLElement).matches(':focus-visible')) setFocused(true); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      {/* first among the slider's controls, so a keyboard reaches it before the slides; pressing «پخش» starts it though the focus is on the button */}
      {many && ready && !calm ? (
        <button
          type="button" className={`${round} absolute bottom-0 left-1 z-20 text-white`} aria-label={playing ? 'ایستادن اسلایدها' : 'پخش خودکار اسلایدها'}
          onClick={() => { setPlaying(!playing); setFocused(false); }}
        >
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </button>
      ) : null}
      <div
        ref={track} role="group" aria-label="اسلایدها" className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto" tabIndex={many ? 0 : undefined}
        // moved by the visitor (a swipe along the row, the arrow keys on it): from here on it is theirs
        onTouchStart={(event) => { const at = event.touches[0]; touchFrom.current = at ? { x: at.clientX, y: at.clientY } : null; }}
        onTouchMove={(event) => {
          const [at, from] = [event.touches[0], touchFrom.current];
          if (!at || !from) return;
          // a finger moving along the row, not one scrolling the page past it or resting on it
          const [dx, dy] = [Math.abs(at.clientX - from.x), Math.abs(at.clientY - from.y)];
          if (dx > 10 && dx > dy) setPlaying(false);
        }}
        onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setPlaying(false); }}
      >
        {slides.map((slide, index) => {
          const Title = heading && index === 0 ? 'h1' : 'p';
          return (
            // one box for every slide; words too long for it make the box (and with it the whole row) taller, never cut
            <div
              key={index} data-slide={index} role="group" aria-roledescription="slide" aria-label={many ? `${faNumber(index + 1)} از ${faNumber(slides.length)}` : undefined}
              className="relative flex min-h-[min(125vw,78vh)] w-full shrink-0 snap-start items-end sm:min-h-[min(37.5vw,78vh)] landscape:min-h-[min(37.5vw,78vh)]"
            >
              <WideImage image={slide.image} mobile={slide.mobileImage} eager={index === 0} fill />
              {slide.title || slide.text || slide.buttonLabel ? (
                <div className={`relative w-full bg-gradient-to-t from-black/75 via-black/45 to-transparent px-4 pt-16 text-white sm:px-16 sm:pt-10 lg:pt-16 ${many ? 'pb-12 lg:pb-14' : 'pb-6 lg:pb-10'}`}>
                  <div className="mx-auto max-w-7xl">
                    {slide.title ? <Title className="line-clamp-3 max-w-2xl text-2xl font-extrabold leading-tight text-balance break-words sm:line-clamp-2 sm:text-4xl lg:text-5xl">{slide.title}</Title> : null}
                    {slide.text ? <p className="mt-2 line-clamp-3 max-w-xl leading-8 break-words sm:line-clamp-2 lg:mt-3 lg:text-lg">{slide.text}</p> : null}
                    {slide.buttonLabel ? (
                      <SlideLink slide={slide} className="mt-4 inline-flex min-h-12 max-w-full items-center gap-2 rounded-control bg-white px-6 py-2 text-lg font-bold text-neutral-900 hover:bg-white/90">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{slide.buttonLabel}</span><ArrowLeft className="size-5 shrink-0" aria-hidden />
                      </SlideLink>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {many && ready ? (
        <>
          <button type="button" className={`${arrow} right-3`} aria-label="اسلاید قبلی" onClick={() => byHand(aim.current - 1)}><ChevronRight className="size-6" aria-hidden /></button>
          <button type="button" className={`${arrow} left-3`} aria-label="اسلاید بعدی" onClick={() => byHand(aim.current + 1)}><ChevronLeft className="size-6" aria-hidden /></button>
          {/* a shade of their own, for a slide without words */}
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-black/60 to-transparent">
            {slides.map((_, index) => (
              <button key={index} type="button" aria-label={`اسلاید ${faNumber(index + 1)}`} aria-current={index === current ? 'true' : undefined} onClick={() => byHand(index)} className={round}>
                <span className={`block size-2.5 rounded-full ${index === current ? 'bg-white' : 'bg-white/50'}`} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

export function HomeBanner({ image, mobileImage, href, external }: { image: SitePageImage; mobileImage: SitePageImage | null; href: string; external: boolean }) {
  const picture = <WideImage image={image} mobile={mobileImage} eager={false} fill={false} />;
  return (
    <section className="mx-auto max-w-7xl px-4 pt-10 lg:px-8 lg:pt-16" data-home-part="banner">
      <div className="overflow-hidden rounded-surface border border-border">
        {href ? <SlideLink slide={{ href, external }} className="block">{picture}</SlideLink> : picture}
      </div>
    </section>
  );
}
