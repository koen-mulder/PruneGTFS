# PruneGTFS

A straightforward web application to reduce the size of GTFS zip files.

> [!CAUTION]
> **This tool is experimental and should not be used for mission-critical tasks!** This application was "vibe coded", with little focus on robust error handling or code quality. Validation that it works was only "Well, this export looks pretty similar to what I wanted to 🤷‍♂️". It may well be completely unreliable.

**Live App:** [https://koen-mulder.github.io/PruneGTFS/](https://koen-mulder.github.io/PruneGTFS/)

## What is this?

PruneGTFS is a simple, client-side tool that takes a GTFS zip file, processes it to reduce its size, and provides a download of the pruned version.

## How to Use

1.  Navigate to the [PruneGTFS web app](https://koen-mulder.github.io/PruneGTFS/).
2.  Click on the "Choose File" button and select the GTFS `.zip` file you want to prune.
3.  Select all the routes you want to keep in the generated GTFS file.
4.  The application will automatically process the file.
5.  Your browser will then download the smaller, pruned GTFS zip file.

## Motivation

This project was created to address a specific need for the [FlixBusDirectRoute](https://github.com/koen-mulder/FlixBusDirectRoute) project. The GTFS data from FlixBus was too large to be uploaded to GitHub in its original, uncompressed form. PruneGTFS was developed as a quick solution to make these large GTFS files more manageable.

## GTFS Data

I got the GTFS data I used from [http://gtfs.gis.flix.tech/gtfs_generic_eu.zip](http://gtfs.gis.flix.tech/gtfs_generic_eu.zip) and found the feed info for this data at [https://www.transit.land/feeds/f-u-flixbus](https://www.transit.land/feeds/f-u-flixbus).
