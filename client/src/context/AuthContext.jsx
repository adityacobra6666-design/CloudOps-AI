import {
    createContext,
    useContext,
    useEffect,
    useState
} from "react";


const AuthContext = createContext();



export const AuthProvider = ({ children }) => {


    const [user, setUser] = useState(null);

    const [token, setToken] = useState(
        localStorage.getItem("token")
    );


    // Load user when app starts
    useEffect(() => {

        const savedUser =
            localStorage.getItem("user");


        if(savedUser){

            setUser(
                JSON.parse(savedUser)
            );

        }

    }, []);



    // LOGIN

    const login = (data)=>{


        localStorage.setItem(
            "token",
            data.token
        );


        localStorage.setItem(
            "user",
            JSON.stringify(data.user)
        );


        setToken(
            data.token
        );


        setUser(
            data.user
        );

    };



    // LOGOUT

    const logout = ()=>{


        localStorage.removeItem(
            "token"
        );


        localStorage.removeItem(
            "user"
        );


        setToken(null);

        setUser(null);

    };



    return (

        <AuthContext.Provider
            value={{
                user,
                token,
                login,
                logout,
                isAuthenticated:
                    !!token
            }}
        >

            {children}

        </AuthContext.Provider>

    );

};



// Custom Hook

export const useAuth = ()=>{

    return useContext(
        AuthContext
    );

};