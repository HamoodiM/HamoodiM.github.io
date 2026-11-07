// Every LinguaSpy video path and poster in one place.
// TODO-V2: a polished cut is being made in C:\GameDevCareer\trailers\linguaspy\v2\. To swap it in,
// run `SRC=/c/GameDevCareer/trailers/linguaspy/v2 scripts/encode-media.sh` (writes the same file
// names below), and if v2 ships new stills, change the poster imports here. Nothing else changes.
import { url } from './site';
import trailerPoster from '../assets/linguaspy/03_paris_grader_hint.png';
import loopPoster from '../assets/linguaspy/loop_poster.png';

export const linguaspyMedia = {
  trailer: {
    src: url('media/linguaspy/linguaspy-trailer.mp4'),
    poster: trailerPoster,
    seconds: 80,
    // TODO-USER: optional, host the trailer on YouTube and set this to the video ID; the page then
    // embeds youtube-nocookie instead of the self-hosted file.
    youtubeId: '' as string,
  },
  loop: {
    src: url('media/linguaspy/linguaspy-loop.mp4'),
    poster: loopPoster,
  },
};
