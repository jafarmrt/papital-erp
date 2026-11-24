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
 * ask the browser to scroll. Every slide has the same box (upright on a phone, wide from 640 px), whatever the shape
 * of its image, so the words over the image always have room and nothing jumps; the image fills the box, and a phone
 * gets the other crop when the shop chose one. The first slide's image is loaded early (it is the largest thing on
 * the page).
 *
 * It moves on by itself every six seconds, and stops while the pointer is over it or the focus is inside it, for good
 * once the visitor moves it by hand or presses «ایستادن», and never starts for a visitor who asked for less motion.
 * Without the script the first slide is there and the row still scrolls; the controls are drawn only once they work.
 */
function WideImage({ image, mobile, eager, fill }: { image: SitePageImage; mobile: SitePageImage | null; eager: boolean; /** fill the slide's box */ fill: boolean }) {
  const media = usePageMediaPath();
  const [width, height] = [image.width ?? 1600, image.height ?? 600];
  return (
    <picture className={fill ? 'absolute inset-0 block' : undefined}>
      {mobile ? <source media="(max-width: 639px)" srcSet={media(mobile.sha256)} width={mobile.width ?? 800} height={mobile.height ?? 1000} /> : null}
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
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!many) return;
    setReady(true);
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
    if (!playing || held) return undefined;
    const timer = window.setInterval(() => { if (!document.hidden) go(aim.current + 1); }, SLIDE_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [playing, held, go]);
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
      onPointerEnter={event => { if (event.pointerType === 'mouse') setHeld(true); }} onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false); }}
    >
      <div ref={track} role="group" aria-label="اسلایدها" aria-live={playing ? 'off' : 'polite'} className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto" tabIndex={many ? 0 : undefined}
        // a swipe: the visitor moves the slider
        onTouchStart={() => setPlaying(false)}
      >
        {slides.map((slide, index) => {
          const Title = heading && index === 0 ? 'h1' : 'p';
          return (
            <div
              key={index} data-slide={index} role="group" aria-roledescription="slide" aria-label={many ? `${faNumber(index + 1)} از ${faNumber(slides.length)}` : undefined}
              className="relative aspect-[4/5] max-h-[78vh] w-full shrink-0 snap-start overflow-hidden sm:aspect-[8/3]"
            >
              <WideImage image={slide.image} mobile={slide.mobileImage} eager={index === 0} fill />
              {slide.title || slide.text || slide.buttonLabel ? (
                <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-4 pt-16 text-white sm:px-8 lg:px-16 ${many ? 'pb-12 lg:pb-14' : 'pb-6 lg:pb-10'}`}>
                  <div className="mx-auto max-w-7xl">
                    {slide.title ? <Title className="line-clamp-3 max-w-2xl text-2xl font-extrabold leading-tight text-balance break-words sm:text-4xl lg:text-5xl">{slide.title}</Title> : null}
                    {slide.text ? <p className="mt-2 line-clamp-3 max-w-xl leading-8 break-words sm:line-clamp-2 lg:mt-3 lg:line-clamp-3 lg:text-lg">{slide.text}</p> : null}
                    {slide.buttonLabel ? (
                      <SlideLink slide={slide} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-control bg-white px-6 text-lg font-bold text-neutral-900 hover:bg-white/90">
                        {slide.buttonLabel}<ArrowLeft className="size-5" aria-hidden />
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
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center">
            {slides.map((_, index) => (
              <button key={index} type="button" aria-label={`اسلاید ${faNumber(index + 1)}`} aria-current={index === current ? 'true' : undefined} onClick={() => byHand(index)} className={round}>
                <span className={`block size-2.5 rounded-full ${index === current ? 'bg-white' : 'bg-white/50'}`} />
              </button>
            ))}
            {/* a visitor who asked for less motion has nothing to stop or start */}
            {lessMotion() ? null : (
              <button type="button" className={`${round} text-white`} aria-label={playing ? 'ایستادن اسلایدها' : 'پخش خودکار اسلایدها'} onClick={() => setPlaying(!playing)}>
                {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              </button>
            )}
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
