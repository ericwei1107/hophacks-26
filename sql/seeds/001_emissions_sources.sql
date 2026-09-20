-- Generated from data/emissions_sources.json. Keep this seed synchronized with
-- the manifest, which is the canonical version-controlled source registry.
INSERT INTO emissions_sources
    (source_id, citation, content, status, source_url, data_url, data_format, retention)
VALUES
    ('barker-marais-mcdowell-2024-global-3d', 'Barker, C.R., Marais, E.A. & McDowell, J.C. (2024), Scientific Data 11, 1079. DOI: 10.1038/s41597-024-03910-z.', 'Global hourly 3D launch and re-entry inventory for 2020-2022, including afterburning and ablation profiles. Reports 63 Gg propellant consumed in 2022 and 3,622 re-entering objects across 2020-2022. NetCDF files are model-ready.', 'VERIFIED', 'https://doi.org/10.1038/s41597-024-03910-z', 'https://rdr.ucl.ac.uk/articles/dataset/Global_3D_rocket_launch_and_re-entry_air_pollutant_and_carbon_dioxide_emissions_for_2020-2022/26325382/1', 'NetCDF4', 'REQUIRED'),
    ('brown-et-al-2024-worldwide-rocket-emissions', 'Brown, T.F.M. et al. (2024), Earth and Space Science 11, e2024EA003668. DOI: 10.1029/2024EA003668.', 'Per-vehicle 3D stratospheric inventory across solid, kerosene, cryogenic, and hypergolic propellants. For 2019 it reports 0.28 Gg black carbon, 0.22 Gg nitrogen oxides, 0.50 Gg reactive chlorine, and 0.91 Gg alumina. Includes contemporary vehicles that did not fly in 2019 for scenario construction.', 'VERIFIED', 'https://doi.org/10.1029/2024EA003668', 'https://doi.org/10.5281/zenodo.10872533', 'Tabulated inventory and NetCDF4', 'REQUIRED'),
    ('callsen-et-al-2026-reference-engine-emissions', 'Callsen, S., Herberhold, M., Wilken, J. & Sippel, M. (2026), CEAS Space Journal. DOI: 10.1007/s12567-026-00760-w.', 'Nozzle-exit-plane emission indices for a 2,200 kN thrust-class baseline across major propellant families, including staged-combustion and gas-generator cycles. Source of R1.', 'VERIFIED', 'https://doi.org/10.1007/s12567-026-00760-w', 'https://elib.dlr.de/226591/', 'Open-access article and reference dataset', 'REQUIRED'),
    ('maloney-et-al-2022-rocket-black-carbon', 'Maloney, C.M., Portmann, R.W., Ross, M.N. & Rosenlof, K.H. (2022), Journal of Geophysical Research: Atmospheres 127(12). DOI: 10.1029/2021JD036373.', 'WACCM6 impact modelling of black-carbon emissions from global rocket launches and ozone response. It is an impact-model study, not an emissions inventory.', 'VERIFIED', 'https://doi.org/10.1029/2021JD036373', 'https://csl.noaa.gov/groups/csl8/modeldata/data/Maloney_etal_2021/', 'CESM2/WACCM6 model output', 'REQUIRED'),
    ('nasa-tm-20240013276-spaceflight-atmosphere', 'Sharma, R.D. (2024), NASA/TM-20240013276, Impact of Spaceflight on Earth''s Atmosphere.', 'Assessment of current modelling capability and research gaps for spaceflight impacts on climate, ozone, and the upper atmosphere. Consult before making accuracy claims.', 'VERIFIED', 'https://ntrs.nasa.gov/citations/20240013276', 'https://ntrs.nasa.gov/api/citations/20240013276/downloads/NASA-TM-20240013276-V6.pdf?attachment=true', 'NASA technical memorandum PDF', 'REQUIRED')
ON CONFLICT (source_id) DO UPDATE
SET citation = EXCLUDED.citation,
    content = EXCLUDED.content,
    status = EXCLUDED.status,
    source_url = EXCLUDED.source_url,
    data_url = EXCLUDED.data_url,
    data_format = EXCLUDED.data_format,
    retention = EXCLUDED.retention,
    ingested_at = CURRENT_TIMESTAMP;
