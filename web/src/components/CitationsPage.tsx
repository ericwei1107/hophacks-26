import { Link, useLocation } from "react-router-dom";

type Citation = { title: string; url: string };

const launchVehicleSources: Citation[] = [
  { title: "SpaceX, Falcon User's Guide, May 2025.", url: "https://www.spacex.com/assets/media/falcon-users-guide-2025-05-09.pdf" },
  { title: "ULA, Atlas V Launch Services User's Guide, Rev. 11, March 2010.", url: "https://www.ulalaunch.com/docs/default-source/rockets/atlasvusersguide2010.pdf" },
  { title: "ULA, Vulcan Launch Systems User's Guide, October 2023.", url: "https://www.ulalaunch.com/docs/default-source/rockets/2023_vulcan_user_guide.pdf" },
  { title: "Rocket Lab, Electron Payload User's Guide v7.0, 1 Nov. 2022.", url: "https://www.rocketlabusa.com/assets/Electron-Payload-User-Guide-7.0-v6.pdf" },
  { title: "Rocket Lab, Neutron Payload User's Guide v1.0, Jan. 2025.", url: "https://www.rocketlabusa.com/assets/Uploads/Rocket-Lab-Neutron-PUG-Reduced.pdf" },
  { title: "Burth et al., NASA Sounding Rockets User Handbook, report 810-HB-SRP, May 2023.", url: "https://ntrs.nasa.gov/citations/20230006855" },
  { title: "NASA Sounding Rockets Program Office, Wallops.", url: "https://sites.wff.nasa.gov/code810/" },
  { title: "ESRA, IREC Design, Test and Evaluation Guide, 2025 rev. v1.1.3.", url: "https://www.soundingrocket.org/uploads/9/0/6/4/9064598/2025_irec_dteg_v1.1.3_10-22-24.pdf" },
];

const earthWeatherSources: Citation[] = [
  { title: "NASA Earthdata Portal.", url: "https://www.earthdata.nasa.gov/" },
  { title: "NASA Earthdata Search, which resolves product short names used in the sheet.", url: "https://search.earthdata.nasa.gov/" },
  { title: "MERRA-2 M2T1NXSLV, DOI 10.5067/VJAFPLI1CSIV.", url: "https://doi.org/10.5067/VJAFPLI1CSIV" },
  { title: "NASA POWER surface meteorology and solar energy.", url: "https://power.larc.nasa.gov/" },
  { title: "Roeder and McNamara, A Survey of the Lightning Launch Commit Criteria, AMS.", url: "https://ams.confex.com/ams/pdfpapers/103803.pdf" },
  { title: "McNamara, Roeder and Merceret, The 2009 Update to the Lightning Launch Commit Criteria, AMS.", url: "https://ams.confex.com/ams/pdfpapers/164180.pdf" },
  { title: "Space Launch Delta 45, Launch Forecast FAQ.", url: "https://www.patrick.spaceforce.mil/Portals/14/Weather/LaunchFAQ.pdf" },
  { title: "Boyd et al., Facilitating the Use of Environmental Information for Space Launch Decisions, AMS.", url: "https://ams.confex.com/ams/pdfpapers/24991.pdf" },
];

const spaceWeatherSources: Citation[] = [
  { title: "NOAA SWPC Products and Data index.", url: "https://www.spaceweather.gov/products-and-data" },
  { title: "NOAA Space Weather Scales.", url: "https://www.swpc.noaa.gov/noaa-scales-explanation" },
  { title: "NOAA SWPC Planetary K-index.", url: "https://www.swpc.noaa.gov/products/planetary-k-index" },
  { title: "NOAA SWPC Solar Wind, DSCOVR real-time.", url: "https://www.swpc.noaa.gov/products/solar-wind" },
  { title: "NOAA SWPC GOES X-ray, proton, and electron flux.", url: "https://www.swpc.noaa.gov/products/goes-x-ray-flux" },
  { title: "NOAA SWPC Geospace Geomagnetic Activity Plot (Dst).", url: "https://www.swpc.noaa.gov/products/geospace-geomagnetic-activity-plot" },
  { title: "NOAA SWPC WSA-Enlil Solar Wind Prediction.", url: "https://www.swpc.noaa.gov/products/wsa-enlil-solar-wind-prediction" },
  { title: "NOAA SWPC D-RAP.", url: "https://www.swpc.noaa.gov/products/d-region-absorption-predictions-d-rap" },
  { title: "NOAA SWPC GloTEC and STORM Time Empirical Ionospheric Correction.", url: "https://www.swpc.noaa.gov/products/glotec" },
  { title: "NOAA SWPC WAM-IPE and Satellite Drag impacts.", url: "https://www.swpc.noaa.gov/products/wam-ipe" },
  { title: "NOAA SWPC Aurora 30 Minute Forecast (OVATION).", url: "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast" },
  { title: "NOAA SWPC alerts, watches and warnings; satellite environment; F10.7 phenomena.", url: "https://www.swpc.noaa.gov/products-and-data" },
  { title: "NCEI archive of SWPC products for historical training data.", url: "https://www.ncei.noaa.gov/products/space-weather" },
];

function PageNav() {
  const location = useLocation();
  const homeTarget = { pathname: "/", search: location.search };
  return <nav aria-label="Site"><Link className="citation-nav-link citation-nav-home" to={homeTarget}>Home</Link><Link className="citation-nav-link" to="/citations">Citations</Link></nav>;
}

function SourceGroup({ title, sources }: { title: string; sources: Citation[] }) {
  return <section className="citation-group"><h2>{title}</h2><ol>{sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ol></section>;
}

export default function CitationsPage() {
  return <main className="citations-page"><header className="citations-header"><Link to="/" className="citations-brand">ZENITH</Link><PageNav /></header><div className="citations-content"><p className="citations-kicker">References</p><h1>Sources and citations</h1><p className="citations-intro">Launch vehicle, Earth-weather, and space-weather references used to inform the simulator.</p><SourceGroup title="Launch vehicle and sounding rocket references" sources={launchVehicleSources} /><SourceGroup title="Earth weather" sources={earthWeatherSources} /><SourceGroup title="Space weather — NOAA SWPC" sources={spaceWeatherSources} /></div></main>;
}
