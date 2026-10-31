-- the read API filters by Nintendo's genre list inside the JP catalog payload
CREATE INDEX regional_listings_genre_idx ON regional_listings USING gin ((source_payload->'genre'));
