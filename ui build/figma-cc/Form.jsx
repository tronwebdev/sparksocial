import { Component2 } from './Component2.jsx';

// figma node: 462:134 Form (1 variants)
const __venc = (v) => String(v).replace(/[%|=]/g, encodeURIComponent);
const __vkey = (p) => "property1=" + __venc(p.property1);

export function Form(_p = {}) {
  const props = { ..._p, property1: _p.property1 ?? "default" };
  const __body0 = () => (
    <div className={props.className} style={{
      width: 638,
      height: 806,
      position: "relative",
      ...props.style,
    }}>
      <svg width={638} height={806} viewBox="0 0 638 806" fill="none" style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 638,
        height: 806,
        borderRadius: 30,
        backdropFilter: "blur(41.304px)",
      }}>
        <path d={"M 1.105 46.236 C 1.105 29.668 14.536 16.236 31.105 16.236 L 269.411 16.236 C 272.715 16.236 275.997 15.69 279.124 14.62 L 311.952 3.386 C 318.36 1.193 325.321 1.233 331.703 3.499 L 362.707 14.507 C 365.93 15.651 369.325 16.236 372.745 16.236 L 608 16.236 C 624.569 16.236 638 29.668 638 46.236 L 638 776 C 638 792.569 624.569 806 608 806 L 30.048 806 C 13.461 806 0.021 792.539 0.048 775.952 L 1.105 111.122 L 1.105 85.968 L 1.105 61.537 L 1.105 46.236 Z"} fill="currentColor" fillRule="nonzero" />
      </svg>
      <div style={{
        position: "absolute",
        left: 43,
        top: 686,
        width: 551,
        height: 90,
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute",
          left: 0,
          top: 41,
          width: 551,
          height: 49,
          opacity: 0.4,
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 551,
            height: 49,
            overflow: "hidden",
          }}>
            <div style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 551,
              height: 49,
              overflow: "hidden",
            }}>
              <div style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 551,
                height: 49,
                borderRadius: 10,
                backgroundColor: "rgb(255,255,255)",
                boxShadow: "inset 0 0 0 1px rgba(131,131,131,0.3)",
              }} />
              <span style={{
                position: "absolute",
                left: 19,
                top: 13,
                width: 62,
                height: 23,
                fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 400,
                fontSize: 18,
                whiteSpace: "nowrap",
                lineHeight: "100%",
                color: "rgb(131,131,131)",
              }}>{props.text1 ?? "https://"}</span>
            </div>
          </div>
        </div>
        <div style={{
            position: "absolute",
            left: 146,
            top: 0,
            width: 45,
            height: 24.324,
          }}>{props.icon1 ?? <Component2 property1={"group 1000016158"} />}</div>
        <span style={{
          position: "absolute",
          left: 1,
          top: 1,
          width: 139,
          height: 23,
          fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
          fontWeight: 600,
          fontSize: 18,
          whiteSpace: "nowrap",
          lineHeight: "100%",
          color: "rgb(12,12,12)",
        }}>{props.text2 ?? "Enable CTA URL"}</span>
        <div style={{
          position: "absolute",
          left: 209,
          top: 2,
          width: 21.563,
          height: 21.563,
          overflow: "hidden",
        }}>
          <svg width={3.594} height={5.750} viewBox="0 0 3.594 5.750" fill="none" style={{
            position: "absolute",
            left: 9.344,
            top: 9.344,
            width: 3.594,
            height: 5.75,
            color: "rgb(131,131,131)",
          }}>
            <path d={"M 3.594 6.5 C 4.008 6.5 4.344 6.164 4.344 5.75 C 4.344 5.336 4.008 5 3.594 5 L 3.594 5.75 L 3.594 6.5 Z M 1.227 0.211 L 0.696 0.741 L 0.697 0.741 L 1.227 0.211 Z M 0 -0.75 C -0.414 -0.75 -0.75 -0.414 -0.75 0 C -0.75 0.414 -0.414 0.75 0 0.75 L 0 0 L 0 -0.75 Z M 3.594 5.75 L 3.594 5 L 2.875 5 L 2.875 5.75 L 2.875 6.5 L 3.594 6.5 L 3.594 5.75 Z M 2.875 5.75 L 2.875 5 C 2.693 5 2.518 4.928 2.389 4.799 L 1.858 5.329 L 1.328 5.859 C 1.738 6.27 2.295 6.5 2.875 6.5 L 2.875 5.75 Z M 1.858 5.329 L 2.389 4.799 C 2.26 4.67 2.188 4.495 2.188 4.313 L 1.438 4.313 L 0.688 4.313 C 0.688 4.893 0.918 5.449 1.328 5.859 L 1.858 5.329 Z M 1.438 4.313 L 2.188 4.313 L 2.188 0.719 L 1.438 0.719 L 0.688 0.719 L 0.688 4.313 L 1.438 4.313 Z M 1.438 0.719 L 2.188 0.719 C 2.188 0.329 2.033 -0.044 1.757 -0.32 L 1.227 0.211 L 0.697 0.741 C 0.691 0.735 0.688 0.727 0.688 0.719 L 1.438 0.719 Z M 1.227 0.211 L 1.757 -0.32 C 1.482 -0.595 1.108 -0.75 0.719 -0.75 L 0.719 0 L 0.719 0.75 C 0.711 0.75 0.702 0.747 0.696 0.741 L 1.227 0.211 Z M 0.719 0 L 0.719 -0.75 L 0 -0.75 L 0 0 L 0 0.75 L 0.719 0.75 L 0.719 0 Z"} fill="currentColor" fillRule="nonzero" />
          </svg>
          <svg width={0.359} height={0.719} viewBox="0 0 0.359 0.719" fill="none" style={{
            position: "absolute",
            left: 10.063,
            top: 5.75,
            width: 0.359,
            height: 0.719,
            color: "rgb(131,131,131)",
          }}>
            <path d={"M 0.359 0.719 L 0.359 -0.031 C 0.575 -0.031 0.75 0.144 0.75 0.359 L 0 0.359 L -0.75 0.359 C -0.75 0.972 -0.253 1.469 0.359 1.469 L 0.359 0.719 Z M 0 0.359 L 0.75 0.359 C 0.75 0.575 0.575 0.75 0.359 0.75 L 0.359 0 L 0.359 -0.75 C -0.253 -0.75 -0.75 -0.253 -0.75 0.359 L 0 0.359 Z"} fill="currentColor" fillRule="nonzero" />
          </svg>
          <svg width={0.359} height={0.719} viewBox="0 0 0.359 0.719" fill="none" style={{
            position: "absolute",
            left: 10.422,
            top: 5.75,
            width: 0.359,
            height: 0.719,
            color: "rgb(131,131,131)",
          }}>
            <path d={"M 0 0.719 L 0 1.469 C 0.613 1.469 1.109 0.972 1.109 0.359 L 0.359 0.359 L -0.391 0.359 C -0.391 0.144 -0.216 -0.031 0 -0.031 L 0 0.719 Z M 0.359 0.359 L 1.109 0.359 C 1.109 -0.253 0.613 -0.75 0 -0.75 L 0 0 L 0 0.75 C -0.216 0.75 -0.391 0.575 -0.391 0.359 L 0.359 0.359 Z"} fill="currentColor" fillRule="nonzero" />
          </svg>
          <svg width={21.563} height={21.563} viewBox="0 0 21.563 21.563" fill="none" style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 21.563,
            height: 21.563,
            color: "rgb(131,131,131)",
          }}>
            <path d={"M 10.781 21.563 L 10.781 22.313 C 17.15 22.313 22.313 17.15 22.313 10.781 L 21.563 10.781 L 20.813 10.781 C 20.813 16.321 16.321 20.813 10.781 20.813 L 10.781 21.563 Z M 21.563 10.781 L 22.313 10.781 C 22.313 4.413 17.15 -0.75 10.781 -0.75 L 10.781 0 L 10.781 0.75 C 16.321 0.75 20.813 5.241 20.813 10.781 L 21.563 10.781 Z M 10.781 0 L 10.781 -0.75 C 4.413 -0.75 -0.75 4.413 -0.75 10.781 L 0 10.781 L 0.75 10.781 C 0.75 5.241 5.241 0.75 10.781 0.75 L 10.781 0 Z M 0 10.781 L -0.75 10.781 C -0.75 17.15 4.413 22.313 10.781 22.313 L 10.781 21.563 L 10.781 20.813 C 5.241 20.813 0.75 16.321 0.75 10.781 L 0 10.781 Z"} fill="currentColor" fillRule="nonzero" />
          </svg>
        </div>
      </div>
      <span style={{
        position: "absolute",
        left: 43,
        top: 42,
        width: 173,
        height: 23,
        fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
        fontWeight: 400,
        fontSize: 16,
        whiteSpace: "nowrap",
        lineHeight: 1.4299999475479126,
        color: "rgb(131,131,131)",
      }}>{props.text3 ?? "Campaign Offer Details"}</span>
      <div style={{
        position: "absolute",
        left: 224,
        top: 42,
        width: 21.563,
        height: 21.563,
        overflow: "hidden",
      }}>
        <svg width={3.594} height={5.750} viewBox="0 0 3.594 5.750" fill="none" style={{
          position: "absolute",
          left: 9.344,
          top: 9.344,
          width: 3.594,
          height: 5.75,
          color: "rgb(131,131,131)",
        }}>
          <path d={"M 3.594 6.5 C 4.008 6.5 4.344 6.164 4.344 5.75 C 4.344 5.336 4.008 5 3.594 5 L 3.594 5.75 L 3.594 6.5 Z M 1.227 0.211 L 0.696 0.741 L 0.697 0.741 L 1.227 0.211 Z M 0 -0.75 C -0.414 -0.75 -0.75 -0.414 -0.75 0 C -0.75 0.414 -0.414 0.75 0 0.75 L 0 0 L 0 -0.75 Z M 3.594 5.75 L 3.594 5 L 2.875 5 L 2.875 5.75 L 2.875 6.5 L 3.594 6.5 L 3.594 5.75 Z M 2.875 5.75 L 2.875 5 C 2.693 5 2.518 4.928 2.389 4.799 L 1.858 5.329 L 1.328 5.859 C 1.738 6.27 2.295 6.5 2.875 6.5 L 2.875 5.75 Z M 1.858 5.329 L 2.389 4.799 C 2.26 4.67 2.188 4.495 2.188 4.313 L 1.438 4.313 L 0.688 4.313 C 0.688 4.893 0.918 5.449 1.328 5.859 L 1.858 5.329 Z M 1.438 4.313 L 2.188 4.313 L 2.188 0.719 L 1.438 0.719 L 0.688 0.719 L 0.688 4.313 L 1.438 4.313 Z M 1.438 0.719 L 2.188 0.719 C 2.188 0.329 2.033 -0.044 1.757 -0.32 L 1.227 0.211 L 0.697 0.741 C 0.691 0.735 0.688 0.727 0.688 0.719 L 1.438 0.719 Z M 1.227 0.211 L 1.757 -0.32 C 1.482 -0.595 1.108 -0.75 0.719 -0.75 L 0.719 0 L 0.719 0.75 C 0.711 0.75 0.702 0.747 0.696 0.741 L 1.227 0.211 Z M 0.719 0 L 0.719 -0.75 L 0 -0.75 L 0 0 L 0 0.75 L 0.719 0.75 L 0.719 0 Z"} fill="currentColor" fillRule="nonzero" />
        </svg>
        <svg width={0.359} height={0.719} viewBox="0 0 0.359 0.719" fill="none" style={{
          position: "absolute",
          left: 10.063,
          top: 5.75,
          width: 0.359,
          height: 0.719,
          color: "rgb(131,131,131)",
        }}>
          <path d={"M 0.359 0.719 L 0.359 -0.031 C 0.575 -0.031 0.75 0.144 0.75 0.359 L 0 0.359 L -0.75 0.359 C -0.75 0.972 -0.253 1.469 0.359 1.469 L 0.359 0.719 Z M 0 0.359 L 0.75 0.359 C 0.75 0.575 0.575 0.75 0.359 0.75 L 0.359 0 L 0.359 -0.75 C -0.253 -0.75 -0.75 -0.253 -0.75 0.359 L 0 0.359 Z"} fill="currentColor" fillRule="nonzero" />
        </svg>
        <svg width={0.359} height={0.719} viewBox="0 0 0.359 0.719" fill="none" style={{
          position: "absolute",
          left: 10.422,
          top: 5.75,
          width: 0.359,
          height: 0.719,
          color: "rgb(131,131,131)",
        }}>
          <path d={"M 0 0.719 L 0 1.469 C 0.613 1.469 1.109 0.972 1.109 0.359 L 0.359 0.359 L -0.391 0.359 C -0.391 0.144 -0.216 -0.031 0 -0.031 L 0 0.719 Z M 0.359 0.359 L 1.109 0.359 C 1.109 -0.253 0.613 -0.75 0 -0.75 L 0 0 L 0 0.75 C -0.216 0.75 -0.391 0.575 -0.391 0.359 L 0.359 0.359 Z"} fill="currentColor" fillRule="nonzero" />
        </svg>
        <svg width={21.563} height={21.563} viewBox="0 0 21.563 21.563" fill="none" style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 21.563,
          height: 21.563,
          color: "rgb(131,131,131)",
        }}>
          <path d={"M 10.781 21.563 L 10.781 22.313 C 17.15 22.313 22.313 17.15 22.313 10.781 L 21.563 10.781 L 20.813 10.781 C 20.813 16.321 16.321 20.813 10.781 20.813 L 10.781 21.563 Z M 21.563 10.781 L 22.313 10.781 C 22.313 4.413 17.15 -0.75 10.781 -0.75 L 10.781 0 L 10.781 0.75 C 16.321 0.75 20.813 5.241 20.813 10.781 L 21.563 10.781 Z M 10.781 0 L 10.781 -0.75 C 4.413 -0.75 -0.75 4.413 -0.75 10.781 L 0 10.781 L 0.75 10.781 C 0.75 5.241 5.241 0.75 10.781 0.75 L 10.781 0 Z M 0 10.781 L -0.75 10.781 C -0.75 17.15 4.413 22.313 10.781 22.313 L 10.781 21.563 L 10.781 20.813 C 5.241 20.813 0.75 16.321 0.75 10.781 L 0 10.781 Z"} fill="currentColor" fillRule="nonzero" />
        </svg>
      </div>
      <div style={{
        position: "absolute",
        left: 43,
        top: 157,
        width: 551,
        height: 499,
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 551,
          height: 499,
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 551,
            height: 499,
            overflow: "hidden",
          }}>
            <div style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 551,
              height: 442,
              borderRadius: 20,
              backgroundColor: "rgb(255,255,255)",
              boxShadow: "inset 0 0 0 1.276px rgba(12,12,12,0.1)",
            }} />
            <div style={{
              position: "absolute",
              left: 26,
              top: 344,
              width: 201,
              height: 28.782,
              overflow: "hidden",
            }}>
              <div style={{
                position: "absolute",
                left: 102,
                top: 0,
                width: 28.782,
                height: 28.782,
                borderRadius: 7.995126724243164,
                backgroundColor: "rgb(0,151,253)",
                boxShadow: "inset 0 0 0 1.009px rgba(12,12,12,0.1)",
              }} />
              <div style={{
                position: "absolute",
                left: 137.04,
                top: 0,
                width: 28.782,
                height: 28.782,
                borderRadius: 7.995126724243164,
                backgroundColor: "rgb(6,197,251)",
                boxShadow: "inset 0 0 0 1.009px rgba(12,12,12,0.1)",
              }} />
              <div style={{
                position: "absolute",
                left: 172.218,
                top: 0,
                width: 28.782,
                height: 28.782,
                borderRadius: 7.995126724243164,
                backgroundColor: "rgb(108,232,255)",
                boxShadow: "inset 0 0 0 1.009px rgba(12,12,12,0.1)",
              }} />
              <span style={{
                position: "absolute",
                left: 0,
                top: 5.453,
                width: 89,
                height: 18,
                fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 500,
                fontSize: 14,
                whiteSpace: "nowrap",
                lineHeight: "100%",
                color: "rgb(131,131,131)",
              }}>{props.text4 ?? "Brand Colors:"}</span>
            </div>
            <div style={{
              position: "absolute",
              left: 26,
              top: 394.166,
              width: 263.04,
              height: 26,
              overflow: "hidden",
            }}>
              <span style={{
                position: "absolute",
                left: 102,
                top: 1,
                width: 61,
                height: 24,
                fontFamily: "\"Asgard Trial\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 700,
                fontSize: 20,
                whiteSpace: "nowrap",
                lineHeight: "100%",
                color: "rgb(12,12,12)",
              }}>Asgard</span>
              <span style={{
                position: "absolute",
                left: 170.04,
                top: 0,
                width: 93,
                height: 26,
                fontFamily: "\"DM Sans\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 700,
                fontSize: 20,
                whiteSpace: "nowrap",
                lineHeight: "100%",
                color: "rgb(12,12,12)",
              }}>, DM Sans</span>
              <span style={{
                position: "absolute",
                left: 0,
                top: 4.287,
                width: 80,
                height: 18,
                fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 500,
                fontSize: 14,
                whiteSpace: "nowrap",
                lineHeight: "100%",
                color: "rgb(131,131,131)",
              }}>Font Styles:</span>
            </div>
            <div style={{
              position: "absolute",
              left: 25,
              top: 73,
              width: 387,
              height: 255,
              overflow: "hidden",
            }}>
              <div style={{
                position: "absolute",
                left: 0,
                top: 208,
                width: 271,
                height: 47,
                overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 271,
                  height: 47,
                  overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: 271,
                    height: 47,
                    borderRadius: 10,
                    backgroundColor: "rgb(243,244,248)",
                    boxShadow: "inset 0 0 0 1.379px rgba(12,12,12,0.1)",
                  }} />
                  <div className="fig-asset-8a2bb401aa473f5a-933e865e" style={{
                    position: "absolute",
                    left: 7,
                    top: 4,
                    width: 37,
                    height: 37,
                  }} />
                </div>
                <span style={{
                  position: "absolute",
                  left: 47,
                  top: 14,
                  width: 210,
                  height: 18,
                  fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                  fontWeight: 500,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  lineHeight: "100%",
                  color: "rgb(131,131,131)",
                }}>Starsocial Company Docs (PDF)</span>
              </div>
              <span style={{
                position: "absolute",
                left: 1,
                top: 176,
                width: 278,
                height: 18,
                fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 500,
                fontSize: 14,
                whiteSpace: "nowrap",
                lineHeight: 1.2690074443817139,
                color: "rgb(131,131,131)",
              }}>(UTC - 08:00). Pacific Time (US &amp; Canada)</span>
              <div className="fig-asset-e7438c5cf2792b21-589ad75d" style={{
                position: "absolute",
                left: 1,
                top: 0,
                width: 63,
                height: 63,
                borderRadius: 48.590423583984375,
                boxShadow: "inset 0 0 0 0.670px rgba(131,131,131,0.4)",
              }} />
              <div style={{
                position: "absolute",
                left: 1,
                top: 132,
                width: 247,
                height: 26.751,
                overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 69.552,
                  height: 26.751,
                  overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: 69.552,
                    height: 26.751,
                    borderRadius: 9.259928703308105,
                    backgroundColor: "rgb(255,255,255)",
                    boxShadow: "inset 0 0 0 0.617px rgba(12,12,12,0.2)",
                  }} />
                  <span style={{
                    position: "absolute",
                    left: 11.592,
                    top: 4.459,
                    width: 46,
                    height: 18,
                    fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                    fontWeight: 500,
                    fontSize: 14.2671480178833,
                    whiteSpace: "nowrap",
                    lineHeight: "100%",
                    color: "rgb(131,131,131)",
                  }}>Formal</span>
                </div>
                <div style={{
                  position: "absolute",
                  left: 74.011,
                  top: 0,
                  width: 67.769,
                  height: 26.751,
                  overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: 67.769,
                    height: 26.751,
                    borderRadius: 9.259928703308105,
                    backgroundColor: "rgb(255,255,255)",
                    boxShadow: "inset 0 0 0 0.617px rgba(12,12,12,0.2)",
                  }} />
                  <span style={{
                    position: "absolute",
                    left: 11.592,
                    top: 4.459,
                    width: 45,
                    height: 18,
                    fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                    fontWeight: 500,
                    fontSize: 14.2671480178833,
                    whiteSpace: "nowrap",
                    lineHeight: "100%",
                    color: "rgb(131,131,131)",
                  }}>Casual</span>
                </div>
                <div style={{
                  position: "absolute",
                  left: 146.238,
                  top: 0,
                  width: 100.762,
                  height: 26.751,
                  overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: 100.762,
                    height: 26.751,
                    borderRadius: 9.259928703308105,
                    backgroundColor: "rgb(255,255,255)",
                    boxShadow: "inset 0 0 0 0.617px rgba(12,12,12,0.2)",
                  }} />
                  <span style={{
                    position: "absolute",
                    left: 8.917,
                    top: 4.459,
                    width: 84,
                    height: 18,
                    fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                    fontWeight: 500,
                    fontSize: 14.2671480178833,
                    whiteSpace: "nowrap",
                    lineHeight: "100%",
                    color: "rgb(131,131,131)",
                  }}>Story driven</span>
                </div>
              </div>
              <span style={{
                position: "absolute",
                left: 1,
                top: 78,
                width: 386,
                height: 40,
                fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 500,
                fontSize: 16,
                lineHeight: 1.2690074443817139,
                color: "rgb(131,131,131)",
              }}>StarSocial links people and brands with engaging, creative social experiences.</span>
              <span style={{
                position: "absolute",
                left: 76,
                top: 4,
                width: 118,
                height: 32,
                fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 600,
                fontSize: 25,
                textAlign: "center",
                whiteSpace: "nowrap",
                lineHeight: 1.2690074443817139,
                color: "rgb(0,0,0)",
              }}>Starsocial</span>
              <span style={{
                position: "absolute",
                left: 76,
                top: 37,
                width: 152,
                height: 23,
                fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 500,
                fontSize: 18,
                textAlign: "center",
                whiteSpace: "nowrap",
                lineHeight: 1.2690074443817139,
                color: "rgb(36,116,237)",
              }}>www.starsocial.io</span>
            </div>
            <svg width={551} height={1} viewBox="0 -0.500 551 1" fill="none" style={{
              position: "absolute",
              left: 0,
              top: 64,
              width: 551,
              height: 1,
              color: "rgba(131,131,131,0.2)",
            }}>
              <path d={"M 0 0 L 0 0.5 L 551 0.5 L 551 0 L 551 -0.5 L 0 -0.5 L 0 0 Z"} fill="currentColor" fillRule="nonzero" />
            </svg>
            <span style={{
              position: "absolute",
              left: 27,
              top: 24,
              width: 406,
              height: 20,
              fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
              fontWeight: 500,
              fontSize: 16,
              whiteSpace: "nowrap",
              lineHeight: 1.273342490196228,
              color: "rgb(131,131,131)",
            }}>I've chosen a type for you based on your recent data.</span>
            <div style={{
              position: "absolute",
              left: 167,
              top: 465,
              width: 104,
              height: 34,
              overflow: "hidden",
            }}>
              <div style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: "matrix(-1,0,0,1,104,0)",
                transformOrigin: "0 0",
                width: 104,
                height: 34,
                borderRadius: 7.481669902801514,
                backgroundColor: "rgb(255,255,255)",
                boxShadow: "inset 0 0 0 0.762px rgb(131,131,131)",
              }} />
              <span style={{
                position: "absolute",
                left: 38,
                top: 7,
                width: 29,
                height: 20,
                fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 400,
                fontSize: 16,
                whiteSpace: "nowrap",
                lineHeight: "100%",
                color: "rgb(0,0,0)",
              }}>Edit</span>
            </div>
            <div style={{
              position: "absolute",
              left: 281,
              top: 465,
              width: 104,
              height: 34,
              overflow: "hidden",
            }}>
              <div style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: "matrix(-1,0,0,1,104,0)",
                transformOrigin: "0 0",
                width: 104,
                height: 34,
                borderRadius: 7.481669902801514,
                backgroundColor: "rgb(12,12,12)",
              }} />
              <span style={{
                position: "absolute",
                left: 10,
                top: 7,
                width: 82,
                height: 20,
                fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
                fontWeight: 400,
                fontSize: 16,
                whiteSpace: "nowrap",
                lineHeight: "100%",
                color: "rgb(255,255,255)",
              }}>+ Add New</span>
            </div>
          </div>
        </div>
      </div>
      <span style={{
        position: "absolute",
        left: 43,
        top: 78,
        width: 351,
        height: 36,
        fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
        fontWeight: 600,
        fontSize: 25,
        whiteSpace: "nowrap",
        lineHeight: 1.4299999475479126,
        color: "rgb(0,0,0)",
      }}>What is this campaign about?</span>
      <span style={{
        position: "absolute",
        left: 43,
        top: 114,
        width: 463,
        height: 23,
        fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
        fontWeight: 400,
        fontSize: 18,
        whiteSpace: "nowrap",
        lineHeight: "99.87000274658203%",
        color: "rgb(131,131,131)",
      }}>Provide me with an anchor, and I’ll craft the messaging.</span>
    </div>
  );
  const __impls = {
    // figma: Property 1=Default
    "property1=default": __body0,
  };
  return (__impls[__vkey(props)] ?? __body0)();
}
export default Form;
