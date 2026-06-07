import '../../styles/headings.css'

export default function Headings({title}) {
    return <header className="header-container">
            <h1>{title}</h1>
            <div className="header-underline"></div>
        </header>
}