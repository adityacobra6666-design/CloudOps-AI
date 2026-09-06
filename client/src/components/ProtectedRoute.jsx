import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";


function ProtectedRoute({ children, roles }) {


    const {
        isAuthenticated,
        user
    } = useAuth();



    if(!isAuthenticated){

        return (
            <Navigate to="/login" />
        );

    }



    if(
        roles &&
        !roles.includes(user?.role)
    ){

        return (
            <Navigate to="/" />
        );

    }



    return children;

}


export default ProtectedRoute;